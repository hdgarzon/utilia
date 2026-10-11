import { prisma } from "@/lib/prisma";
import { colombiaDayOf, colombiaToday, daysBetween } from "@/lib/timezone";

/**
 * Capital muerto = producto con stock y mas de DEAD_STOCK_DAYS dias sin venta.
 * Unica definicion del sistema: Liquidacion, el Resumen, el ABC y los estados
 * deben contar lo mismo. (Antes el Resumen usaba "sin venta en 7 dias" y daba
 * 7x mas que Liquidacion.)
 */
export const DEAD_STOCK_DAYS = 30;

/**
 * Regla dura de no-recompra: con mas de NO_REORDER_DAYS dias sin venta un
 * producto no se repone (reabastecimiento, minimos/maximos) y comprarlo de
 * todas formas sale como alerta en Compras.
 */
export const NO_REORDER_DAYS = 45;

export interface DeadStockProduct {
  id: string;
  name: string;
  category: string | null;
  stockQty: number;
  cmp: number;
  salePrice: number;
  rotationDays: number;
  lastSoldAt: Date | null;
  investedCapital: number; // stockQty * cmp
  retailValue: number;     // stockQty * salePrice
}

export interface DeadStockByCategory {
  category: string;
  investedCapital: number;
  retailValue: number;
  productCount: number;
}

export interface DeadStockAnalysis {
  products: DeadStockProduct[];      // todos, sin cap — la tabla filtra/pagina en cliente
  totalInvestedCapital: number;
  totalRetailValue: number;
  totalInventoryValue: number;       // valor de TODO el inventario con stock > 0
  deadStockPctOfInventory: number;   // totalInvestedCapital / totalInventoryValue * 100
  byCategory: DeadStockByCategory[]; // ordenado por investedCapital desc
}

export async function getDeadStockAnalysis(): Promise<DeadStockAnalysis> {
  const [deadRows, allRows] = await Promise.all([
    prisma.productInsight.findMany({
      where: { rotationDays: { gt: DEAD_STOCK_DAYS }, stockQty: { gt: 0 } },
      orderBy: { rotationDays: "desc" },
    }),
    prisma.productInsight.findMany({
      where: { stockQty: { gt: 0 } },
      select: { stockQty: true, cmp: true },
    }),
  ]);

  const products: DeadStockProduct[] = deadRows.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    stockQty: p.stockQty,
    cmp: p.cmp,
    salePrice: p.salePrice,
    rotationDays: p.rotationDays,
    lastSoldAt: p.lastSoldAt,
    investedCapital: p.stockQty * p.cmp,
    retailValue: p.stockQty * p.salePrice,
  }));

  const totalInvestedCapital = products.reduce((s, p) => s + p.investedCapital, 0);
  const totalRetailValue = products.reduce((s, p) => s + p.retailValue, 0);
  const totalInventoryValue = allRows.reduce((s, r) => s + r.stockQty * r.cmp, 0);
  const deadStockPctOfInventory = totalInventoryValue > 0 ? (totalInvestedCapital / totalInventoryValue) * 100 : 0;

  const catMap = new Map<string, { investedCapital: number; retailValue: number; productCount: number }>();
  for (const p of products) {
    const key = p.category ?? "Sin categoría";
    const cur = catMap.get(key) ?? { investedCapital: 0, retailValue: 0, productCount: 0 };
    cur.investedCapital += p.investedCapital;
    cur.retailValue += p.retailValue;
    cur.productCount += 1;
    catMap.set(key, cur);
  }
  const byCategory: DeadStockByCategory[] = Array.from(catMap.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.investedCapital - a.investedCapital);

  return {
    products,
    totalInvestedCapital,
    totalRetailValue,
    totalInventoryValue,
    deadStockPctOfInventory,
    byCategory,
  };
}

const GOAL_AMOUNT_KEY = "dead_stock_goal_amount";
const GOAL_BASELINE_KEY = "dead_stock_goal_baseline";
const GOAL_DEADLINE_KEY = "dead_stock_goal_deadline";

export interface GoalPace {
  progress: number;        // capital liberado desde que se fijo la meta
  remaining: number;       // lo que falta para la meta (0 si se cumplio)
  daysElapsed: number;
  daysLeft: number;        // negativo = la fecha ya paso
  requiredPerWeek: number; // lo que hay que liberar por semana desde hoy
  actualPerWeek: number;   // ritmo real desde que se fijo la meta
  status: "met" | "on_track" | "behind" | "overdue";
}

export interface LiquidationGoal {
  goalAmount: number;        // 0 = sin meta fijada
  baseline: number;          // capital muerto total al momento de fijar la meta
  deadline: string | null;   // YYYY-MM-DD; sin fecha la meta no tiene ritmo
  updatedAt: Date | null;
  currentDeadStock: number;  // pasado por el caller — evita una consulta duplicada
  pace: GoalPace | null;
}

/**
 * Ritmo de la meta: cuanto se ha liberado, cuanto falta por semana para llegar
 * a la fecha y si el ritmo real alcanza. Pura, para poder probarla.
 *
 * Una meta sin fecha no obliga a nada: por eso la fecha es parte de la meta y
 * el veredicto compara el ritmo real contra el necesario, no solo el avance.
 */
export function computeGoalPace(input: {
  goalAmount: number;
  baseline: number;
  currentDeadStock: number;
  setOn: Date;     // dia (Colombia) en que se fijo la meta
  deadline: Date;  // dia limite
  today: Date;
}): GoalPace {
  const progress = Math.max(input.baseline - input.currentDeadStock, 0);
  const remaining = Math.max(input.goalAmount - progress, 0);
  const daysElapsed = Math.max(daysBetween(input.setOn, input.today), 0);
  const daysLeft = daysBetween(input.today, input.deadline);
  const requiredPerWeek = remaining > 0 && daysLeft > 0 ? (remaining / daysLeft) * 7 : remaining;
  const actualPerWeek = daysElapsed > 0 ? (progress / daysElapsed) * 7 : 0;

  let status: GoalPace["status"];
  if (remaining === 0) status = "met";
  else if (daysLeft < 0) status = "overdue";
  // Los primeros dias no hay ritmo que medir: se da el beneficio de la duda.
  else if (daysElapsed < 7 || actualPerWeek >= requiredPerWeek) status = "on_track";
  else status = "behind";

  return { progress, remaining, daysElapsed, daysLeft, requiredPerWeek, actualPerWeek, status };
}

/**
 * El progreso de la meta es 100% derivado de datos reales, sin ninguna
 * acción manual de "marcar como liquidado": progreso = baseline - capital
 * muerto actual. A medida que el sync de Odoo refleje que ese stock
 * efectivamente se vendió, el capital muerto baja solo y la meta avanza.
 *
 * `currentDeadStock` se recibe como parámetro (no se recalcula aquí) porque
 * el caller (la página) ya llamó a getDeadStockAnalysis() — evita una
 * segunda consulta concurrente redundante contra el mismo pool de conexiones
 * (lección de la PR #12: apilar fetches concurrentes de más agota el pool
 * local de conexiones y hace fallar otras queries en silencio).
 */
export async function getLiquidationGoal(currentDeadStock: number): Promise<LiquidationGoal> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [GOAL_AMOUNT_KEY, GOAL_BASELINE_KEY, GOAL_DEADLINE_KEY] } },
  });
  const goalRow = rows.find((r) => r.key === GOAL_AMOUNT_KEY);
  const baselineRow = rows.find((r) => r.key === GOAL_BASELINE_KEY);
  const deadlineRow = rows.find((r) => r.key === GOAL_DEADLINE_KEY);
  const rawGoal = goalRow ? Number(goalRow.value) : 0;
  const rawBaseline = baselineRow ? Number(baselineRow.value) : 0;
  const goalAmount = Number.isFinite(rawGoal) ? rawGoal : 0;
  const baseline = Number.isFinite(rawBaseline) ? rawBaseline : 0;
  const deadline = deadlineRow && /^\d{4}-\d{2}-\d{2}$/.test(deadlineRow.value) ? deadlineRow.value : null;
  const updatedAt = goalRow?.updatedAt ?? null;

  const pace =
    goalAmount > 0 && deadline && updatedAt
      ? computeGoalPace({
          goalAmount,
          baseline,
          currentDeadStock,
          setOn: colombiaDayOf(updatedAt),
          deadline: new Date(`${deadline}T00:00:00Z`),
          today: colombiaToday(),
        })
      : null;

  return { goalAmount, baseline, deadline, updatedAt, currentDeadStock, pace };
}

/**
 * Fija una meta nueva: guarda monto, fecha limite y la línea base (capital
 * muerto actual) juntos, para que el progreso arranque en 0%.
 */
export async function setLiquidationGoal(goalAmount: number, baseline: number, deadline: string): Promise<void> {
  const upsert = (key: string, value: string) =>
    prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  await prisma.$transaction([
    upsert(GOAL_AMOUNT_KEY, String(goalAmount)),
    upsert(GOAL_BASELINE_KEY, String(baseline)),
    upsert(GOAL_DEADLINE_KEY, deadline),
  ]);
}
