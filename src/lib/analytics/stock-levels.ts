import { prisma } from "@/lib/prisma";
import { isServiceCategory } from "@/lib/service-categories";

/**
 * Niveles minimo y maximo de stock por producto.
 *
 * Modelo clasico de punto de reorden:
 *   minStock (punto de reorden) = demanda durante la entrega + stock de seguridad
 *   maxStock                    = minStock + demanda del ciclo de cobertura
 *
 * El stock de seguridad cubre la variabilidad: un producto que vende 2/dia
 * constantes necesita menos colchon que uno que vende 0 unos dias y 6 otros.
 */

/** Dias de entrega por defecto mientras no haya historial medido por proveedor. */
export const DEFAULT_LEAD_TIME_DAYS = 7;
/** Cobertura objetivo del ciclo, la misma que usa el plan OTB. */
export const DEFAULT_COVERAGE_DAYS = 21;
/** Factor de servicio ~95% (z de la normal). */
const SERVICE_FACTOR = 1.65;

const LEAD_TIME_SETTING_KEY = "replenishment.leadTimeDays";

export interface LevelInput {
  avgDailySales7d: number;
  demandStdDev: number; // desviacion de la venta diaria
  rotationDays: number; // dias desde la ultima venta
  category: string | null;
}

export interface StockLevels {
  safetyStock: number;
  minStock: number;
  maxStock: number;
}

/**
 * Calcula los tres niveles. Pura: se puede verificar sin base de datos.
 *
 * Devuelve todo en cero para lo que no se repone — servicios, productos sin
 * rotacion y los que superan la regla dura de no-recompra (45 dias sin venta).
 * Un minimo de 5 en algo que no vende hace meses es capital muerto disfrazado
 * de politica de inventario.
 */
export function computeStockLevels(
  p: LevelInput,
  leadTimeDays: number,
  coverageDays: number = DEFAULT_COVERAGE_DAYS
): StockLevels {
  const noSeRepone =
    isServiceCategory(p.category) || p.avgDailySales7d <= 0 || p.rotationDays > 45;
  if (noSeRepone) return { safetyStock: 0, minStock: 0, maxStock: 0 };

  const safetyStock = Math.ceil(SERVICE_FACTOR * p.demandStdDev * Math.sqrt(leadTimeDays));
  const minStock = Math.ceil(p.avgDailySales7d * leadTimeDays) + safetyStock;
  const maxStock = Math.ceil(p.avgDailySales7d * (leadTimeDays + coverageDays)) + safetyStock;
  return { safetyStock, minStock, maxStock };
}

/** Dias de entrega configurados. Cae al default si no se ha fijado o es invalido. */
export async function getLeadTimeDays(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: LEAD_TIME_SETTING_KEY } });
  const n = Number(row?.value);
  return Number.isFinite(n) && n >= 1 && n <= 120 ? Math.round(n) : DEFAULT_LEAD_TIME_DAYS;
}

export async function setLeadTimeDays(days: number): Promise<void> {
  if (!Number.isFinite(days) || days < 1 || days > 120) {
    throw new Error("Los dias de entrega deben estar entre 1 y 120");
  }
  const value = String(Math.round(days));
  await prisma.setting.upsert({
    where: { key: LEAD_TIME_SETTING_KEY },
    create: { key: LEAD_TIME_SETTING_KEY, value },
    update: { value },
  });
}

export interface RecomputeResult {
  evaluated: number;
  withLevels: number; // productos que si se reponen
  leadTimeDays: number;
}

/**
 * Recalcula los niveles de todo el catalogo y los persiste. Se llama al final
 * del sync, cuando velocidades y desviacion ya estan frescas.
 */
export async function recomputeStockLevels(): Promise<RecomputeResult> {
  const leadTimeDays = await getLeadTimeDays();
  const rows = await prisma.productInsight.findMany({
    select: {
      odooProductId: true, avgDailySales7d: true, demandStdDev: true,
      rotationDays: true, category: true,
    },
  });

  const now = new Date();
  let withLevels = 0;
  const values: string[] = [];
  for (const r of rows) {
    const l = computeStockLevels(r, leadTimeDays);
    if (l.minStock > 0) withLevels++;
    values.push(`(${r.odooProductId}, ${l.minStock}, ${l.maxStock}, ${l.safetyStock})`);
  }

  // Escritura en lote: solo numeros, una sentencia por bloque de 1000.
  const CHUNK = 1000;
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK).join(",");
    await prisma.$executeRawUnsafe(`
      UPDATE "ProductInsight" p
      SET "minStock" = v.min_s, "maxStock" = v.max_s, "safetyStock" = v.safe_s,
          "levelsUpdatedAt" = '${now.toISOString()}'
      FROM (VALUES ${slice}) AS v("odooProductId", min_s, max_s, safe_s)
      WHERE p."odooProductId" = v."odooProductId"
    `);
  }

  return { evaluated: rows.length, withLevels, leadTimeDays };
}
