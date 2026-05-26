import { prisma } from "@/lib/prisma";

export type CoverageBrake = "urgente" | "normal" | "freno";

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
  estimatedInvestment: number;       // unitsToBuy * avgCMP (sin freno)
  adjustedInvestment: number;        // con freno de mano aplicado
  estimatedRevenue: number;          // projectedMonthlyUnits * avgSalePrice
  estimatedProfit: number;
  estimatedROI: number;              // estimatedProfit / estimatedInvestment * 100
  // Salud y distribución
  currentCoverageDays: number;       // currentStockUnits / dailySales
  coverageBrake: CoverageBrake;      // "urgente" <30d | "normal" | "freno" >60d
  salesParticipationPct: number;     // % del total de ventas proyectadas
  reinvestmentShare: number;         // cuánto del fondo de reposición le toca según participación
}

export interface OTBPlan {
  coverageDaysTarget: number;        // input: días de stock objetivo al cierre (default 21)
  categories: OTBCategory[];
  totals: {
    totalInvestment: number;         // sin freno
    totalAdjustedInvestment: number; // con freno de mano
    totalUnits: number;
    totalProjectedRevenue: number;
    totalProjectedProfit: number;
    avgROI: number;
  };
  // Fondo de Reposición: COGS real de los últimos 30 días
  // = el dinero que "ya le pertenece" al inventario y debe reinvertirse
  reinvestmentFund: number;
  reinvestmentFundDays: number;      // días de datos usados para calcularlo
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
  // Fondo de Reposición: COGS real de los últimos 30 días desde FinancialSnapshot
  const last30Start = new Date(Date.now() - 30 * 86_400_000);
  const recentSnaps = await prisma.financialSnapshot.findMany({
    where: { date: { gte: last30Start } },
    select: { totalCost: true },
  });
  const reinvestmentFund = recentSnaps.reduce((s, r) => s + r.totalCost, 0);
  const reinvestmentFundDays = recentSnaps.length;

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

  // Paso 1: calcular métricas base por categoría
  const totalRevenueAll = rows.reduce((s, r) => s + (r.revenue_proxy ?? 0), 0);

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

    // Freno de mano: >60 días de cobertura → reducir 50%; <30 días → urgente 100%
    const coverageBrake: CoverageBrake =
      currentCoverageDays > 60 ? "freno" : currentCoverageDays < 30 ? "urgente" : "normal";
    const brakeMultiplier = coverageBrake === "freno" ? 0.5 : 1.0;
    const adjustedInvestment = estimatedInvestment * brakeMultiplier;

    // Participación de ventas
    const salesParticipationPct = totalRevenueAll > 0 ? (estimatedRevenue / totalRevenueAll) * 100 : 0;
    // Cuánto del fondo de reposición le corresponde según su % de ventas
    const reinvestmentShare = reinvestmentFund * (salesParticipationPct / 100);

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
      adjustedInvestment,
      estimatedRevenue,
      estimatedProfit,
      estimatedROI,
      currentCoverageDays,
      coverageBrake,
      salesParticipationPct,
      reinvestmentShare,
    };
  });

  const totals = {
    totalInvestment: categories.reduce((s, c) => s + c.estimatedInvestment, 0),
    totalAdjustedInvestment: categories.reduce((s, c) => s + c.adjustedInvestment, 0),
    totalUnits: categories.reduce((s, c) => s + c.unitsToBuy, 0),
    totalProjectedRevenue: categories.reduce((s, c) => s + c.estimatedRevenue, 0),
    totalProjectedProfit: categories.reduce((s, c) => s + c.estimatedProfit, 0),
    avgROI: 0,
  };
  totals.avgROI = totals.totalInvestment > 0 ? (totals.totalProjectedProfit / totals.totalInvestment) * 100 : 0;

  return { coverageDaysTarget, categories, totals, reinvestmentFund, reinvestmentFundDays };
}
