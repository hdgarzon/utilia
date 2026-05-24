import { prisma } from "@/lib/prisma";

export interface OTBCategory {
  category: string;
  rawCategory: string | null;
  // Volumen
  totalDailySales: number;
  projectedMonthlyUnits: number;     // velocidad * 30
  currentStockUnits: number;
  desiredEndingStockUnits: number;   // velocidad * coverageDays_target
  // OTB Real (Open-to-Buy en unidades y dinero)
  unitsToBuy: number;                // = projected + desired_end - current (con piso en 0)
  // Valoración
  avgCMP: number;                    // CMP promedio ponderado por velocidad
  estimatedInvestment: number;       // unitsToBuy * avgCMP
  estimatedRevenue: number;          // projectedMonthlyUnits * avgSalePrice
  estimatedProfit: number;
  estimatedROI: number;              // estimatedProfit / estimatedInvestment * 100
  // Salud
  currentCoverageDays: number;       // currentStockUnits / dailySales
}

export interface OTBPlan {
  coverageDaysTarget: number;        // input: días de stock objetivo al cierre (default 21)
  categories: OTBCategory[];
  totals: {
    totalInvestment: number;
    totalUnits: number;
    totalProjectedRevenue: number;
    totalProjectedProfit: number;
    avgROI: number;
  };
}

/**
 * Genera el plan Open-to-Buy por categoría para el próximo período.
 *
 * Fórmula clásica de retail:
 *   OTB = ventas_proyectadas + stock_final_deseado - stock_actual
 *
 * Devuelve unidades y valor monetario por categoría, listo para que el
 * dueño decida cuánto pedirle a cada proveedor o asignar al presupuesto
 * de compras del mes siguiente.
 */
export async function getOpenToBuyPlan(coverageDaysTarget = 21): Promise<OTBPlan> {
  // Aggregate por categoría desde ProductInsight
  const rows = await prisma.$queryRaw<
    Array<{
      category: string | null;
      total_daily_sales: number | null;
      total_stock: number | null;
      revenue_proxy: number | null;
      profit_proxy: number | null;
      // CMP promedio ponderado por velocidad (productos que venden pesan más)
      weighted_cmp_numerator: number | null;
      weighted_cmp_denominator: number | null;
      avg_sale_price: number | null;
    }>
  >`
    SELECT
      category,
      COALESCE(SUM("avgDailySales7d"), 0)                            AS total_daily_sales,
      COALESCE(SUM("stockQty"), 0)                                   AS total_stock,
      COALESCE(SUM("avgDailySales7d" * "salePrice" * 30), 0)         AS revenue_proxy,
      COALESCE(SUM("avgDailySales7d" * ("salePrice" - cmp) * 30), 0) AS profit_proxy,
      COALESCE(SUM("avgDailySales7d" * cmp), 0)                      AS weighted_cmp_numerator,
      COALESCE(SUM("avgDailySales7d"), 0)                            AS weighted_cmp_denominator,
      COALESCE(AVG("salePrice") FILTER (WHERE "avgDailySales7d" > 0), 0) AS avg_sale_price
    FROM "ProductInsight"
    WHERE "avgDailySales7d" > 0  -- solo productos con rotación; el resto no entra al OTB
    GROUP BY category
    ORDER BY revenue_proxy DESC NULLS LAST
  `;

  const categories: OTBCategory[] = rows.map((r) => {
    const totalDailySales = r.total_daily_sales ?? 0;
    const projectedMonthlyUnits = totalDailySales * 30;
    const desiredEndingStockUnits = totalDailySales * coverageDaysTarget;
    const currentStockUnits = r.total_stock ?? 0;
    const unitsToBuy = Math.max(projectedMonthlyUnits + desiredEndingStockUnits - currentStockUnits, 0);

    const weightedCMPNum = r.weighted_cmp_numerator ?? 0;
    const weightedCMPDen = r.weighted_cmp_denominator ?? 0;
    const avgCMP = weightedCMPDen > 0 ? weightedCMPNum / weightedCMPDen : 0;

    const estimatedInvestment = unitsToBuy * avgCMP;
    const estimatedRevenue = r.revenue_proxy ?? 0;
    const estimatedProfit = r.profit_proxy ?? 0;
    const estimatedROI = estimatedInvestment > 0 ? (estimatedProfit / estimatedInvestment) * 100 : 0;

    const currentCoverageDays = totalDailySales > 0 ? currentStockUnits / totalDailySales : 0;

    return {
      category: r.category ?? "Sin categoría",
      rawCategory: r.category,
      totalDailySales,
      projectedMonthlyUnits,
      currentStockUnits,
      desiredEndingStockUnits,
      unitsToBuy,
      avgCMP,
      estimatedInvestment,
      estimatedRevenue,
      estimatedProfit,
      estimatedROI,
      currentCoverageDays,
    };
  });

  const totals = {
    totalInvestment: categories.reduce((s, c) => s + c.estimatedInvestment, 0),
    totalUnits: categories.reduce((s, c) => s + c.unitsToBuy, 0),
    totalProjectedRevenue: categories.reduce((s, c) => s + c.estimatedRevenue, 0),
    totalProjectedProfit: categories.reduce((s, c) => s + c.estimatedProfit, 0),
    avgROI: 0,
  };
  totals.avgROI = totals.totalInvestment > 0 ? (totals.totalProjectedProfit / totals.totalInvestment) * 100 : 0;

  return { coverageDaysTarget, categories, totals };
}
