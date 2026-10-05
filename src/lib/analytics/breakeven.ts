import { prisma } from "@/lib/prisma";
import { odoo } from "@/lib/odoo";
import { colombiaToday } from "@/lib/timezone";
import type { TrailingActivity } from "./financial-month";

export interface BreakevenAnalysis {
  /** false si falta presupuesto o margen: sin eso no hay equilibrio que calcular. */
  computable: boolean;
  fixedExpensesMonthly: number;
  fixedExpensesDaily: number;      // por dia calendario
  grossMarginPct: number;          // ultimos 30 dias cerrados, ponderado por ingreso
  sellingDaysPct: number;          // % de dias calendario con venta en la ventana
  // Punto de equilibrio
  breakevenRevenue: number;        // venta necesaria por dia que se abre
  breakevenTransactions: number;
  avgTicket: number;
  // Hoy
  todayRevenue: number;
  todayTransactions: number;
  isLiveToday: boolean;            // en vivo desde Odoo, no de un snapshot
  todayProgress: number;           // 0–1+
  todayDelta: number;              // negativo = aun falta
  // Historia
  daysAboveBreakeven: number;
  daysWithSales: number;
  windowDays: number;
}

export interface TodaySales {
  revenue: number;
  transactions: number;
  isLive: boolean;
}

/**
 * Venta minima por dia de apertura para cubrir el gasto fijo:
 *
 *   gasto fijo del mes / dias del mes        → lo que cuesta cada dia calendario
 *   ÷ proporcion de dias que se abre         → los dias abiertos cubren tambien los cerrados
 *   ÷ margen bruto                           → de cada peso vendido solo el margen paga gastos
 *
 * Ej: $6,5M de gasto fijo en 31 dias = $210k/dia; si se abre el 90% de los
 * dias, cada dia abierto carga $233k; con 49% de margen hay que vender $476k.
 */
export function computeBreakeven(input: {
  fixedExpensesMonthly: number;
  daysInMonth: number;
  trailing: TrailingActivity;
  today: TodaySales;
}): BreakevenAnalysis {
  const { fixedExpensesMonthly, daysInMonth, trailing, today } = input;
  const fixedExpensesDaily = fixedExpensesMonthly / daysInMonth;
  const grossMarginPct = trailing.revenue > 0 ? (trailing.grossProfit / trailing.revenue) * 100 : 0;
  const sellingRatio = trailing.calendarDays > 0 ? Math.min(trailing.daysWithSales / trailing.calendarDays, 1) : 1;
  const fixedPerSellingDay = sellingRatio > 0 ? fixedExpensesDaily / sellingRatio : fixedExpensesDaily;

  const computable = fixedExpensesMonthly > 0 && grossMarginPct > 0;
  const breakevenRevenue = computable ? fixedPerSellingDay / (grossMarginPct / 100) : 0;
  const avgTicket = trailing.transactions > 0 ? trailing.revenue / trailing.transactions : 0;
  const breakevenTransactions = avgTicket > 0 ? Math.ceil(breakevenRevenue / avgTicket) : 0;

  return {
    computable,
    fixedExpensesMonthly,
    fixedExpensesDaily,
    grossMarginPct,
    sellingDaysPct: sellingRatio * 100,
    breakevenRevenue,
    breakevenTransactions,
    avgTicket,
    todayRevenue: today.revenue,
    todayTransactions: today.transactions,
    isLiveToday: today.isLive,
    todayProgress: breakevenRevenue > 0 ? today.revenue / breakevenRevenue : 0,
    todayDelta: today.revenue - breakevenRevenue,
    daysAboveBreakeven: computable ? trailing.dailyRevenue.filter((r) => r >= breakevenRevenue).length : 0,
    daysWithSales: trailing.daysWithSales,
    windowDays: trailing.windowDays,
  };
}

/**
 * Venta de hoy en vivo desde Odoo (la misma base que el grafico horario). El
 * snapshot de hoy solo se actualiza al sincronizar: con el podia decir "te
 * faltan $X" con la tienda ya vendiendo. Se usa solo si Odoo no responde.
 */
export async function getTodaySales(): Promise<TodaySales> {
  const [hourly, snapshot] = await Promise.all([
    odoo.getTodayHourlySales().catch(() => [] as Awaited<ReturnType<typeof odoo.getTodayHourlySales>>),
    prisma.financialSnapshot.findUnique({
      where: { date: colombiaToday() },
      select: { totalRevenue: true, transactionCount: true },
    }),
  ]);
  const liveTransactions = hourly.reduce((s, h) => s + h.transactions, 0);
  if (liveTransactions > 0) {
    return { revenue: hourly.reduce((s, h) => s + h.revenue, 0), transactions: liveTransactions, isLive: true };
  }
  return { revenue: snapshot?.totalRevenue ?? 0, transactions: snapshot?.transactionCount ?? 0, isLive: false };
}

export async function getBreakevenAnalysis(input: {
  fixedExpensesMonthly: number;
  daysInMonth: number;
  trailing: TrailingActivity;
}): Promise<BreakevenAnalysis> {
  return computeBreakeven({ ...input, today: await getTodaySales() });
}
