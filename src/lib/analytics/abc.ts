import { prisma } from "@/lib/prisma";

export type ABCTier = "A" | "B" | "C";

export interface ABCProduct {
  id: string;
  odooProductId: number;
  name: string;
  category: string | null;
  stockQty: number;
  cmp: number;
  salePrice: number;
  avgDailySales7d: number;
  monthlyRevenueProxy: number;   // velocidad_día * precio * 30
  monthlyProfitProxy: number;    // velocidad_día * margen * 30
  marginPct: number;
  tier: ABCTier;
  cumulativeRevenuePct: number;  // 0..100, lugar en la curva de Pareto
  rank: number;                  // 1 = más vendido
}

export interface ABCAnalysis {
  products: ABCProduct[];        // ordenados por revenue desc
  tierSummary: {
    [k in ABCTier]: {
      count: number;
      revenueShare: number;        // % del total proyectado
      profitShare: number;
      productPct: number;          // % del catálogo activo
      inventoryValue: number;      // valor CMP combinado
    };
  };
  paretoCount: number;           // cuántos productos forman el 80% del revenue (Pareto)
  paretoPct: number;             // qué % del catálogo es ese pareto
  totalMonthlyRevenue: number;
  totalMonthlyProfit: number;
  generatedAt: Date;
}

/**
 * Clasifica los productos activos (con ventas en los últimos 7d) en tiers:
 *   - A: productos que acumulan hasta 80% del revenue proyectado mensual
 *   - B: siguiente 15% (80→95%)
 *   - C: último 5% (95→100%)
 *
 * Usa `avgDailySales7d * salePrice * 30` como proxy de revenue mensual
 * (es lo que tenemos sin recorrer pos.order.line a nivel orden histórica).
 */
export async function getABCAnalysis(): Promise<ABCAnalysis> {
  const rawProducts = await prisma.productInsight.findMany({
    where: { avgDailySales7d: { gt: 0 }, salePrice: { gt: 0 } },
    select: {
      id: true,
      odooProductId: true,
      odooTemplateId: true,
      templateName: true,
      name: true,
      category: true,
      stockQty: true,
      cmp: true,
      salePrice: true,
      avgDailySales7d: true,
    },
  });

  // Agrupar variantes del mismo template en un producto consolidado.
  // Precio y costo efectivos: promedio ponderado por velocidad de venta.
  const groups = new Map<string, typeof rawProducts>();
  for (const p of rawProducts) {
    const key = p.odooTemplateId !== null ? `t_${p.odooTemplateId}` : `p_${p.odooProductId}`;
    const g = groups.get(key) ?? [];
    g.push(p);
    groups.set(key, g);
  }
  const products = Array.from(groups.values()).map((variants) => {
    const totalSales = variants.reduce((s, v) => s + v.avgDailySales7d, 0);
    const totalStock = variants.reduce((s, v) => s + v.stockQty, 0);
    const weightedPrice = totalSales > 0
      ? variants.reduce((s, v) => s + v.avgDailySales7d * v.salePrice, 0) / totalSales
      : variants[0].salePrice;
    const weightedCmp = totalSales > 0
      ? variants.reduce((s, v) => s + v.avgDailySales7d * v.cmp, 0) / totalSales
      : variants[0].cmp;
    const rep = variants[0];
    return {
      id: rep.id,
      odooProductId: rep.odooTemplateId ?? rep.odooProductId,
      name: rep.templateName ?? rep.name,
      category: rep.category,
      stockQty: totalStock,
      cmp: weightedCmp,
      salePrice: weightedPrice,
      avgDailySales7d: totalSales,
    };
  });

  // Calcular revenue mensual proxy y ordenar desc
  const enriched = products
    .map((p) => {
      const monthlyRevenueProxy = p.avgDailySales7d * p.salePrice * 30;
      const monthlyProfitProxy = p.avgDailySales7d * (p.salePrice - p.cmp) * 30;
      const marginPct = p.salePrice > 0 ? ((p.salePrice - p.cmp) / p.salePrice) * 100 : 0;
      return { ...p, monthlyRevenueProxy, monthlyProfitProxy, marginPct };
    })
    .sort((a, b) => b.monthlyRevenueProxy - a.monthlyRevenueProxy);

  const totalMonthlyRevenue = enriched.reduce((s, p) => s + p.monthlyRevenueProxy, 0);
  const totalMonthlyProfit = enriched.reduce((s, p) => s + p.monthlyProfitProxy, 0);

  // Acumulado para asignar tier
  let cumRevenue = 0;
  let paretoCount = 0;
  const classified: ABCProduct[] = enriched.map((p, i) => {
    cumRevenue += p.monthlyRevenueProxy;
    const cumPct = totalMonthlyRevenue > 0 ? (cumRevenue / totalMonthlyRevenue) * 100 : 0;
    let tier: ABCTier;
    if (cumPct <= 80) tier = "A";
    else if (cumPct <= 95) tier = "B";
    else tier = "C";
    if (cumPct <= 80) paretoCount = i + 1;
    return { ...p, tier, cumulativeRevenuePct: cumPct, rank: i + 1 };
  });

  // Resumen por tier
  const blank = { count: 0, revenue: 0, profit: 0, inventoryValue: 0 };
  const aggs = { A: { ...blank }, B: { ...blank }, C: { ...blank } };
  for (const p of classified) {
    aggs[p.tier].count += 1;
    aggs[p.tier].revenue += p.monthlyRevenueProxy;
    aggs[p.tier].profit += p.monthlyProfitProxy;
    aggs[p.tier].inventoryValue += p.stockQty * p.cmp;
  }

  const totalCount = classified.length;
  const tierSummary = {
    A: {
      count: aggs.A.count,
      revenueShare: totalMonthlyRevenue > 0 ? (aggs.A.revenue / totalMonthlyRevenue) * 100 : 0,
      profitShare: totalMonthlyProfit > 0 ? (aggs.A.profit / totalMonthlyProfit) * 100 : 0,
      productPct: totalCount > 0 ? (aggs.A.count / totalCount) * 100 : 0,
      inventoryValue: aggs.A.inventoryValue,
    },
    B: {
      count: aggs.B.count,
      revenueShare: totalMonthlyRevenue > 0 ? (aggs.B.revenue / totalMonthlyRevenue) * 100 : 0,
      profitShare: totalMonthlyProfit > 0 ? (aggs.B.profit / totalMonthlyProfit) * 100 : 0,
      productPct: totalCount > 0 ? (aggs.B.count / totalCount) * 100 : 0,
      inventoryValue: aggs.B.inventoryValue,
    },
    C: {
      count: aggs.C.count,
      revenueShare: totalMonthlyRevenue > 0 ? (aggs.C.revenue / totalMonthlyRevenue) * 100 : 0,
      profitShare: totalMonthlyProfit > 0 ? (aggs.C.profit / totalMonthlyProfit) * 100 : 0,
      productPct: totalCount > 0 ? (aggs.C.count / totalCount) * 100 : 0,
      inventoryValue: aggs.C.inventoryValue,
    },
  };

  return {
    products: classified,
    tierSummary,
    paretoCount,
    paretoPct: totalCount > 0 ? (paretoCount / totalCount) * 100 : 0,
    totalMonthlyRevenue,
    totalMonthlyProfit,
    generatedAt: new Date(),
  };
}
