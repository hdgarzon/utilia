import { prisma } from "@/lib/prisma";

export interface CategoryCost {
  category: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
  revenuePct: number;
}

export interface RevenueWaterfall {
  totalRevenue: number;
  totalCogs: number;
  totalFixedExpenses: number;
  grossProfit: number;
  netProfit: number;
  cogsPctOfRevenue: number;
  fixedPctOfRevenue: number;
  netPctOfRevenue: number;
  categories: CategoryCost[];
}

/**
 * Cascada del dinero: de los ingresos del mes, cuánto se va a reponer mercancía
 * (desglosado por categoría), cuánto a gastos fijos, y cuánto queda de utilidad.
 *
 * Usa datos reales del mes (FinancialSnapshot para totales, ProductInsight para
 * el desglose por categoría). Las categorías se calculan desde la velocidad de
 * venta × costo/precio × 30d (proxy mensual consistente con el OTB).
 */
export async function getRevenueWaterfall(year: number, month: number): Promise<RevenueWaterfall> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const [snapshots, catRows] = await Promise.all([
    prisma.financialSnapshot.findMany({
      where: { date: { gte: start, lt: end } },
      select: { totalRevenue: true, totalCost: true, fixedExpenses: true },
    }),
    prisma.$queryRaw<
      Array<{ category: string | null; rev: number; cogs: number }>
    >`
      SELECT
        category,
        COALESCE(SUM("avgDailySales7d" * "salePrice" * 30), 0) AS rev,
        COALESCE(SUM("avgDailySales7d" * cmp * 30), 0) AS cogs
      FROM "ProductInsight"
      WHERE "avgDailySales7d" > 0
      GROUP BY category
      ORDER BY rev DESC
    `,
  ]);

  const totalRevenue = snapshots.reduce((s, x) => s + x.totalRevenue, 0);
  const totalCogs = snapshots.reduce((s, x) => s + x.totalCost, 0);
  const totalFixedExpenses = snapshots.reduce((s, x) => s + x.fixedExpenses, 0);
  const grossProfit = totalRevenue - totalCogs;
  const netProfit = grossProfit - totalFixedExpenses;

  const catTotalRev = catRows.reduce((s, c) => s + (c.rev ?? 0), 0);

  const categories: CategoryCost[] = catRows.map((c) => {
    const revenue = c.rev ?? 0;
    const cogs = c.cogs ?? 0;
    const gp = revenue - cogs;
    return {
      category: c.category ?? "Sin categoría",
      revenue,
      cogs,
      grossProfit: gp,
      marginPct: revenue > 0 ? (gp / revenue) * 100 : 0,
      revenuePct: catTotalRev > 0 ? (revenue / catTotalRev) * 100 : 0,
    };
  });

  return {
    totalRevenue,
    totalCogs,
    totalFixedExpenses,
    grossProfit,
    netProfit,
    cogsPctOfRevenue: totalRevenue > 0 ? (totalCogs / totalRevenue) * 100 : 0,
    fixedPctOfRevenue: totalRevenue > 0 ? (totalFixedExpenses / totalRevenue) * 100 : 0,
    netPctOfRevenue: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0,
    categories,
  };
}
