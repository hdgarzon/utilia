import { prisma } from "@/lib/prisma";

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
      where: { rotationDays: { gt: 30 }, stockQty: { gt: 0 } },
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

export interface LiquidationGoal {
  goalAmount: number;        // 0 = sin meta fijada
  baseline: number;          // capital muerto total al momento de fijar la meta
  updatedAt: Date | null;
  currentDeadStock: number;  // pasado por el caller — evita una consulta duplicada
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
  const [goalRow, baselineRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: GOAL_AMOUNT_KEY } }),
    prisma.setting.findUnique({ where: { key: GOAL_BASELINE_KEY } }),
  ]);
  const goalAmount = goalRow ? Number(goalRow.value) : 0;
  const baseline = baselineRow ? Number(baselineRow.value) : 0;
  return {
    goalAmount: Number.isFinite(goalAmount) ? goalAmount : 0,
    baseline: Number.isFinite(baseline) ? baseline : 0,
    updatedAt: goalRow?.updatedAt ?? null,
    currentDeadStock,
  };
}

/** Fija una meta nueva: guarda el monto Y la línea base (capital muerto actual) juntos, para que el progreso arranque en 0%. */
export async function setLiquidationGoal(goalAmount: number, baseline: number): Promise<void> {
  await prisma.$transaction([
    prisma.setting.upsert({
      where: { key: GOAL_AMOUNT_KEY },
      create: { key: GOAL_AMOUNT_KEY, value: String(goalAmount) },
      update: { value: String(goalAmount) },
    }),
    prisma.setting.upsert({
      where: { key: GOAL_BASELINE_KEY },
      create: { key: GOAL_BASELINE_KEY, value: String(baseline) },
      update: { value: String(baseline) },
    }),
  ]);
}
