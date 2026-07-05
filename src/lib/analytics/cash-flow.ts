import { prisma } from "@/lib/prisma";
import { colombiaDaysAgo } from "@/lib/timezone";

const CASH_BALANCE_KEY = "cash_balance";

// Runway = saldo / burn. Solo tiene sentido con suficiente historia y un saldo
// razonablemente actual; si no, un burn extrapolado de pocos días o un saldo
// viejo produce un "0.2 meses" alarmante y falso.
const MIN_DAYS_FOR_RUNWAY = 14;
const STALE_BALANCE_DAYS = 21;

export interface CashFlowAnalysis {
  // Saldo
  cashBalance: number;             // saldo actual ingresado por el usuario
  cashBalanceUpdatedAt: Date | null;
  // Tasas mensuales promedio (últimos 30 días)
  avgMonthlyRevenue: number;
  avgMonthlyCogs: number;          // costo de bienes vendidos
  avgMonthlyGrossProfit: number;
  avgMonthlyFixedExpenses: number;
  avgMonthlyNetProfit: number;     // = grossProfit - fixedExpenses
  // Burn rate & runway
  burnRateMonthly: number;         // si negativo (quemás plata), runway aplica
  isBurning: boolean;              // true cuando burnRateMonthly < 0
  runwayMonths: number | null;     // null si no aplica: no quemás, datos insuficientes o saldo viejo
  runwayReliable: boolean;         // true solo si el runway es confiable (ver guardas)
  lowConfidence: boolean;          // < MIN_DAYS_FOR_RUNWAY días de historia
  balanceStale: boolean;           // saldo sin actualizar hace > STALE_BALANCE_DAYS
  daysSinceBalanceUpdate: number | null;
  // Proyección
  projected30dCash: number;        // saldo + netProfit avg mensual
  projected90dCash: number;
  daysObserved: number;
}

export async function getCashBalance(): Promise<{ value: number; updatedAt: Date | null }> {
  const row = await prisma.setting.findUnique({ where: { key: CASH_BALANCE_KEY } });
  if (!row) return { value: 0, updatedAt: null };
  const parsed = Number(row.value);
  return { value: Number.isFinite(parsed) ? parsed : 0, updatedAt: row.updatedAt };
}

export async function setCashBalance(amount: number): Promise<void> {
  await prisma.setting.upsert({
    where: { key: CASH_BALANCE_KEY },
    create: { key: CASH_BALANCE_KEY, value: String(amount) },
    update: { value: String(amount) },
  });
}

/**
 * Calcula burn rate, runway y proyección de cash a 30/90 días.
 *
 * burn_rate_mes = (gastos_fijos_mes_promedio - utilidad_bruta_mes_promedio)
 *   Positivo → quemás plata cada mes
 *   Negativo → te queda plata cada mes (en ese caso no hay "runway", crece)
 *
 * runway = saldo_actual / burn_rate_mes
 */
export async function getCashFlowAnalysis(): Promise<CashFlowAnalysis> {
  // Ventana MÓVIL real de 30 días (no MTD): el burn/runway es una TASA y debe
  // medirse sobre un horizonte estable. Con MTD, a inicio de mes se extrapolaba
  // el promedio de 2-3 días × 30 y el runway salía catastróficamente bajo.
  const [cashRow, recent30] = await Promise.all([
    getCashBalance(),
    prisma.financialSnapshot.findMany({
      where: { date: { gte: colombiaDaysAgo(30) } },
      select: { totalRevenue: true, totalCost: true, grossProfit: true, fixedExpenses: true, netProfit: true },
    }),
  ]);

  const days = recent30.length;
  const avgDailyRevenue = days > 0 ? recent30.reduce((s, r) => s + r.totalRevenue, 0) / days : 0;
  const avgDailyCogs = days > 0 ? recent30.reduce((s, r) => s + r.totalCost, 0) / days : 0;
  const avgDailyGrossProfit = days > 0 ? recent30.reduce((s, r) => s + r.grossProfit, 0) / days : 0;
  const avgDailyFixedExpenses = days > 0 ? recent30.reduce((s, r) => s + r.fixedExpenses, 0) / days : 0;
  const avgDailyNetProfit = days > 0 ? recent30.reduce((s, r) => s + r.netProfit, 0) / days : 0;

  // Escalado a mensual (30 días)
  const avgMonthlyRevenue = avgDailyRevenue * 30;
  const avgMonthlyCogs = avgDailyCogs * 30;
  const avgMonthlyGrossProfit = avgDailyGrossProfit * 30;
  const avgMonthlyFixedExpenses = avgDailyFixedExpenses * 30;
  const avgMonthlyNetProfit = avgDailyNetProfit * 30;

  // Burn = lo que se va por encima de lo que entra (en bruto, después de COGS)
  // Si grossProfit cubre los fixedExpenses, no hay burn.
  const burnRateMonthly = avgMonthlyFixedExpenses - avgMonthlyGrossProfit;
  const isBurning = burnRateMonthly > 0;

  // Guardas de confiabilidad del runway.
  const daysSinceBalanceUpdate = cashRow.updatedAt
    ? Math.floor((Date.now() - cashRow.updatedAt.getTime()) / 86_400_000)
    : null;
  const balanceStale = daysSinceBalanceUpdate !== null && daysSinceBalanceUpdate > STALE_BALANCE_DAYS;
  const lowConfidence = days < MIN_DAYS_FOR_RUNWAY;
  const runwayReliable = isBurning && cashRow.value > 0 && !lowConfidence && !balanceStale;
  const runwayMonths = runwayReliable ? cashRow.value / burnRateMonthly : null;

  // Proyección
  const projected30dCash = cashRow.value + avgMonthlyNetProfit;
  const projected90dCash = cashRow.value + avgMonthlyNetProfit * 3;

  return {
    cashBalance: cashRow.value,
    cashBalanceUpdatedAt: cashRow.updatedAt,
    avgMonthlyRevenue,
    avgMonthlyCogs,
    avgMonthlyGrossProfit,
    avgMonthlyFixedExpenses,
    avgMonthlyNetProfit,
    burnRateMonthly,
    isBurning,
    runwayMonths,
    runwayReliable,
    lowConfidence,
    balanceStale,
    daysSinceBalanceUpdate,
    projected30dCash,
    projected90dCash,
    daysObserved: days,
  };
}
