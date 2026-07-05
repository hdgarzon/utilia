import { prisma } from "@/lib/prisma";
import { odoo } from "@/lib/odoo";
import { colombiaToday, colombiaStartOfMonth, colombiaYearMonthDay } from "@/lib/timezone";

export interface BreakevenAnalysis {
  // Inputs base
  fixedExpensesDaily: number;        // gastos fijos prorrateados por día
  fixedExpensesMonthly: number;      // total presupuesto del mes
  avgGrossMarginPct: number;         // margen bruto promedio últimos 30d
  // Punto de equilibrio
  breakevenRevenue: number;          // ingresos que necesitas para cubrir gastos fijos
  breakevenTransactions: number;     // transacciones aprox (basado en ticket promedio reciente)
  // Estado de hoy
  todayRevenue: number;
  todayTransactions: number;
  isLiveToday: boolean;              // true si viene de Odoo en vivo, no de un snapshot desactualizado
  todayProgress: number;             // 0–1 (porcentaje cubierto del breakeven)
  todayDelta: number;                // diferencia COP vs breakeven (negativo = aún falta)
  // Contexto histórico
  daysAboveBreakeven30d: number;     // cuántos de los últimos 30 días superaron breakeven
  daysObserved30d: number;           // total de días con datos en últimos 30
  avgTicketRecent: number;
}

/**
 * Calcula el punto de equilibrio diario a partir de:
 *   1) Presupuesto de gastos fijos del mes actual → prorrateado por día
 *   2) Margen bruto promedio (revenue - cost) / revenue de los últimos 30 días
 *
 * Lo importante: si tu margen bruto es 40% y tus gastos fijos son $225k/día,
 * necesitas vender $225k / 0.40 = $562k al día para no perder plata.
 */
export async function getBreakevenAnalysis(): Promise<BreakevenAnalysis> {
  const { year, month } = colombiaYearMonthDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = colombiaToday();

  const [budgets, todaySnap, recent30, hourlyRaw] = await Promise.all([
    prisma.expenseBudget.findMany({ where: { year, month } }),
    prisma.financialSnapshot.findUnique({ where: { date: today } }),
    prisma.financialSnapshot.findMany({
      where: { date: { gte: colombiaStartOfMonth() } },
      select: { totalRevenue: true, totalCost: true, transactionCount: true, avgTicket: true },
    }),
    odoo.getTodayHourlySales().catch(() => [] as Awaited<ReturnType<typeof odoo.getTodayHourlySales>>),
  ]);

  const fixedExpensesMonthly = budgets.reduce((s, b) => s + b.budgetAmount, 0);
  const fixedExpensesDaily = fixedExpensesMonthly / daysInMonth;

  // Margen bruto promedio ponderado por revenue
  const totalRev = recent30.reduce((s, r) => s + r.totalRevenue, 0);
  const totalCost = recent30.reduce((s, r) => s + r.totalCost, 0);
  const avgGrossMarginPct = totalRev > 0 ? ((totalRev - totalCost) / totalRev) * 100 : 0;

  // Ticket promedio reciente para estimar transacciones
  const totalTxn = recent30.reduce((s, r) => s + r.transactionCount, 0);
  const avgTicketRecent = totalTxn > 0 ? totalRev / totalTxn : 0;

  // El breakeven en revenue requiere cubrir gastos fijos con la utilidad bruta
  const breakevenRevenue =
    avgGrossMarginPct > 0 ? fixedExpensesDaily / (avgGrossMarginPct / 100) : 0;
  const breakevenTransactions =
    avgTicketRecent > 0 ? Math.ceil(breakevenRevenue / avgTicketRecent) : 0;

  // Estado de hoy: en vivo desde Odoo (misma base que el gráfico horario y el
  // sync) en vez del snapshot, que solo se actualiza al sincronizar y podía
  // mostrar "te faltan $X" con la tienda ya vendiendo.
  const liveRevenue = hourlyRaw.reduce((s, h) => s + h.revenue, 0);
  const liveTransactions = hourlyRaw.reduce((s, h) => s + h.transactions, 0);
  const isLiveToday = liveTransactions > 0;

  const todayRevenue = isLiveToday ? liveRevenue : (todaySnap?.totalRevenue ?? 0);
  const todayTransactions = isLiveToday ? liveTransactions : (todaySnap?.transactionCount ?? 0);
  const todayProgress = breakevenRevenue > 0 ? todayRevenue / breakevenRevenue : 0;
  const todayDelta = todayRevenue - breakevenRevenue;

  // Cuántos días en los últimos 30 superaron breakeven
  const daysAboveBreakeven30d = recent30.filter((r) => r.totalRevenue >= breakevenRevenue).length;

  return {
    fixedExpensesDaily,
    fixedExpensesMonthly,
    avgGrossMarginPct,
    breakevenRevenue,
    breakevenTransactions,
    todayRevenue,
    todayTransactions,
    isLiveToday,
    todayProgress,
    todayDelta,
    daysAboveBreakeven30d,
    daysObserved30d: recent30.length,
    avgTicketRecent,
  };
}
