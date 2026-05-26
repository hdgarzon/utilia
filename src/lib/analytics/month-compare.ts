import { prisma } from "@/lib/prisma";
import { colombiaYearMonthDay } from "@/lib/timezone";

export interface MonthMetrics {
  label: string;          // "Mayo 2026"
  year: number;
  month: number;
  daysWithData: number;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  totalFixedExpenses: number;
  netProfit: number;
  totalTransactions: number;
  avgDailyRevenue: number;
  avgTicket: number;
  netMarginPct: number;
}

export interface MonthComparison {
  current: MonthMetrics;
  previous: MonthMetrics;
  /** Comparable MTD: same number of days from start of month in previous month */
  currentMTD: MonthMetrics;
  previousMTD: MonthMetrics;
  deltas: {
    revenue: number;       // % change (current MTD vs prev MTD)
    transactions: number;
    avgTicket: number;
    netProfit: number;
    margin: number;        // pp (puntos porcentuales)
  };
}

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

async function aggregateMonth(year: number, month: number, dayCap?: number): Promise<MonthMetrics> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = dayCap
    ? new Date(Date.UTC(year, month - 1, dayCap + 1))
    : new Date(Date.UTC(year, month, 1));

  const rows = await prisma.financialSnapshot.findMany({
    where: { date: { gte: start, lt: end } },
    select: {
      totalRevenue: true,
      totalCost: true,
      grossProfit: true,
      fixedExpenses: true,
      netProfit: true,
      transactionCount: true,
      avgTicket: true,
    },
  });

  const totalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0);
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0);
  const grossProfit = rows.reduce((s, r) => s + r.grossProfit, 0);
  const totalFixedExpenses = rows.reduce((s, r) => s + r.fixedExpenses, 0);
  const netProfit = rows.reduce((s, r) => s + r.netProfit, 0);
  const totalTransactions = rows.reduce((s, r) => s + r.transactionCount, 0);
  const avgTicket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
  const avgDailyRevenue = rows.length > 0 ? totalRevenue / rows.length : 0;
  const netMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  return {
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    year,
    month,
    daysWithData: rows.length,
    totalRevenue,
    totalCost,
    grossProfit,
    totalFixedExpenses,
    netProfit,
    totalTransactions,
    avgDailyRevenue,
    avgTicket,
    netMarginPct,
  };
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Compara mes actual vs mes anterior, total y también MTD (mismos N días desde el 1).
 */
export async function getMonthComparison(): Promise<MonthComparison> {
  const { year: curYear, month: curMonth, day: curDay } = colombiaYearMonthDay();
  const prevDate = new Date(curYear, curMonth - 2, 1);
  const prevYear = prevDate.getFullYear();
  const prevMonth = prevDate.getMonth() + 1;

  const [current, previous, currentMTD, previousMTD] = await Promise.all([
    aggregateMonth(curYear, curMonth),
    aggregateMonth(prevYear, prevMonth),
    aggregateMonth(curYear, curMonth, curDay),
    aggregateMonth(prevYear, prevMonth, curDay),
  ]);

  return {
    current,
    previous,
    currentMTD,
    previousMTD,
    deltas: {
      revenue: pctChange(currentMTD.totalRevenue, previousMTD.totalRevenue),
      transactions: pctChange(currentMTD.totalTransactions, previousMTD.totalTransactions),
      avgTicket: pctChange(currentMTD.avgTicket, previousMTD.avgTicket),
      netProfit: pctChange(currentMTD.netProfit, previousMTD.netProfit),
      margin: currentMTD.netMarginPct - previousMTD.netMarginPct,
    },
  };
}
