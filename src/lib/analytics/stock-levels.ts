import { prisma } from "@/lib/prisma";
import { isServiceCategory } from "@/lib/service-categories";
import { getSeasonalIndex, fortnightKey, fortnightKeyIn, lookupIndex } from "@/lib/analytics/seasonality";

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
  seasonalFactor: number;
}

/**
 * Techo y piso del ajuste estacional. Con uno o dos años de historia un indice
 * extremo puede ser una racha, no un patron: sin topes, una piñateria con
 * indice 3,2 en diciembre dispararia un pedido enorme por una sola navidad
 * observada.
 */
const SEASONAL_MAX = 2.5;
const SEASONAL_MIN = 0.5;

/**
 * Cuanto hay que ajustar la velocidad actual para la temporada que viene.
 *
 * La velocidad de los ultimos 7 dias YA trae el efecto de la temporada actual,
 * asi que lo que importa es el cambio relativo: si hoy estamos en una quincena
 * floja y entramos a una alta, el cociente sube; si es al reves, baja.
 */
export function seasonalFactorFor(
  indiceActual: number | null,
  indiceFuturo: number | null
): number {
  if (!indiceActual || !indiceFuturo || indiceActual <= 0) return 1;
  const raw = indiceFuturo / indiceActual;
  return Math.min(SEASONAL_MAX, Math.max(SEASONAL_MIN, raw));
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
  coverageDays: number = DEFAULT_COVERAGE_DAYS,
  seasonalFactor = 1
): StockLevels {
  const noSeRepone =
    isServiceCategory(p.category) || p.avgDailySales7d <= 0 || p.rotationDays > 45;
  if (noSeRepone) return { safetyStock: 0, minStock: 0, maxStock: 0, seasonalFactor: 1 };

  // La velocidad se proyecta a la temporada en la que se consumira el pedido,
  // no a la de hoy: por eso el factor multiplica antes de calcular los niveles.
  const velocidad = p.avgDailySales7d * seasonalFactor;
  const safetyStock = Math.ceil(SERVICE_FACTOR * p.demandStdDev * Math.sqrt(leadTimeDays));
  const minStock = Math.ceil(velocidad * leadTimeDays) + safetyStock;
  const maxStock = Math.ceil(velocidad * (leadTimeDays + coverageDays)) + safetyStock;
  return { safetyStock, minStock, maxStock, seasonalFactor };
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
  seasonallyAdjusted: number; // productos cuyo nivel cambio por temporada
  fortnightAhead: string; // quincena para la que se proyecto
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

  // El pedido se consumira durante la cobertura que empieza cuando llegue, asi
  // que la temporada relevante es la de mitad de esa ventana, no la de hoy.
  const idx = await getSeasonalIndex().catch((err) => {
    console.error("[stock-levels] no se pudo calcular el indice estacional:", err);
    return [];
  });
  const now = new Date();
  const quincenaActual = fortnightKey(now);
  const quincenaFutura = fortnightKeyIn(leadTimeDays + Math.round(DEFAULT_COVERAGE_DAYS / 2), now);

  let withLevels = 0;
  let seasonallyAdjusted = 0;
  const values: string[] = [];
  for (const r of rows) {
    const factor = seasonalFactorFor(
      lookupIndex(idx, r.category, quincenaActual)?.index ?? null,
      lookupIndex(idx, r.category, quincenaFutura)?.index ?? null
    );
    const l = computeStockLevels(r, leadTimeDays, DEFAULT_COVERAGE_DAYS, factor);
    if (l.minStock > 0) withLevels++;
    if (l.minStock > 0 && Math.abs(factor - 1) > 0.05) seasonallyAdjusted++;
    values.push(`(${r.odooProductId}, ${l.minStock}, ${l.maxStock}, ${l.safetyStock}, ${l.seasonalFactor})`);
  }

  // Escritura en lote: solo numeros, una sentencia por bloque de 1000.
  const CHUNK = 1000;
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK).join(",");
    await prisma.$executeRawUnsafe(`
      UPDATE "ProductInsight" p
      SET "minStock" = v.min_s, "maxStock" = v.max_s, "safetyStock" = v.safe_s,
          "seasonalFactor" = v.season, "levelsUpdatedAt" = '${now.toISOString()}'
      FROM (VALUES ${slice}) AS v("odooProductId", min_s, max_s, safe_s, season)
      WHERE p."odooProductId" = v."odooProductId"
    `);
  }

  return { evaluated: rows.length, withLevels, leadTimeDays, seasonallyAdjusted, fortnightAhead: quincenaFutura };
}
