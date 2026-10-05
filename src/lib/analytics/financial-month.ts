import { prisma } from "@/lib/prisma";
import { formatMonthLabel } from "@/lib/utils";
import {
  addDays,
  colombiaDayOf,
  colombiaDaysAgo,
  daysBetween,
  daysInMonth,
  isoDay,
  monthStart,
  previousMonth,
} from "@/lib/timezone";
import { getBudgetRowsThrough, pickMonthBudget, type MonthFixedExpenses } from "@/lib/fixed-expenses";
import { computeMonthEndProjection, type MonthEndProjection } from "./month-projection";

/**
 * Estado de resultados de un mes: la unica fuente de ingresos, costo, gasto
 * fijo y utilidad que usa el Centro Financiero (y el resumen del inicio).
 *
 * Tres reglas que antes se rompian:
 *
 * 1. El gasto fijo se cobra por DIA CALENDARIO, no por dia con venta. El
 *    arriendo corre aunque la tienda cierre: sumar el gasto fijo guardado en
 *    cada snapshot dejaba sin cobrar los domingos y festivos sin venta, y meses
 *    en perdida aparecian con utilidad.
 * 2. Solo cuentan dias CERRADOS segun el ultimo sync (`getDataCutoff`). Hoy
 *    aun no termina, y un dia sin snapshot despues del ultimo sync no es un
 *    dia sin ventas: es un dia que aun no llega.
 * 3. El gasto fijo sale del presupuesto vigente (heredado si el mes no tiene
 *    el suyo), no del valor denormalizado en FinancialSnapshot, que queda en 0
 *    si el snapshot se escribio antes de existir el presupuesto.
 */

/** Margen neto desde el que el mes se considera sano. Por debajo, "ajustado". */
export const HEALTHY_NET_MARGIN_PCT = 10;

export interface SnapshotTotals {
  date: Date;
  totalRevenue: number;
  totalCost: number;
  transactionCount: number;
}

export interface DailyFinancialRow {
  date: string; // YYYY-MM-DD
  revenue: number;
  cost: number;
  grossProfit: number;
  transactions: number;
  /** Gasto fijo que le toca al dia: presupuesto del mes / dias del mes. */
  fixedExpense: number;
  netProfit: number;
}

export interface MonthPnL {
  year: number;
  month: number;
  label: string;
  daysInMonth: number;
  /** Dias calendario cubiertos (del 1 al `daysElapsed`). */
  daysElapsed: number;
  daysWithSales: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  grossMarginPct: number;
  fixed: MonthFixedExpenses;
  fixedDaily: number;
  /** Gasto fijo de los dias cubiertos. Igual a `fixed.monthly` en un mes cerrado. */
  fixedCharged: number;
  netProfit: number;
  netMarginPct: number;
  transactions: number;
  avgTicket: number;
  /** Un registro por dia calendario cubierto, con ceros los dias sin venta. */
  days: DailyFinancialRow[];
}

export function buildMonthPnL(args: {
  year: number;
  month: number;
  daysElapsed: number;
  snapshots: SnapshotTotals[];
  fixed: MonthFixedExpenses;
}): MonthPnL {
  const { year, month, snapshots, fixed } = args;
  const dim = daysInMonth(year, month);
  const elapsed = Math.min(Math.max(args.daysElapsed, 0), dim);
  const fixedDaily = fixed.monthly / dim;
  const byDay = new Map(snapshots.map((s) => [isoDay(s.date), s]));
  const start = monthStart(year, month);

  const days: DailyFinancialRow[] = [];
  for (let i = 0; i < elapsed; i++) {
    const date = isoDay(addDays(start, i));
    const s = byDay.get(date);
    const revenue = s?.totalRevenue ?? 0;
    const cost = s?.totalCost ?? 0;
    const grossProfit = revenue - cost;
    days.push({
      date,
      revenue,
      cost,
      grossProfit,
      transactions: s?.transactionCount ?? 0,
      fixedExpense: fixedDaily,
      netProfit: grossProfit - fixedDaily,
    });
  }

  const revenue = days.reduce((s, d) => s + d.revenue, 0);
  const cost = days.reduce((s, d) => s + d.cost, 0);
  const transactions = days.reduce((s, d) => s + d.transactions, 0);
  const grossProfit = revenue - cost;
  const fixedCharged = fixedDaily * elapsed;
  const netProfit = grossProfit - fixedCharged;

  return {
    year,
    month,
    label: formatMonthLabel(year, month),
    daysInMonth: dim,
    daysElapsed: elapsed,
    daysWithSales: days.filter((d) => d.transactions > 0 || d.revenue !== 0).length,
    revenue,
    cost,
    grossProfit,
    grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    fixed,
    fixedDaily,
    fixedCharged,
    netProfit,
    netMarginPct: revenue > 0 ? (netProfit / revenue) * 100 : 0,
    transactions,
    avgTicket: transactions > 0 ? revenue / transactions : 0,
    days,
  };
}

export interface MonthDeltas {
  revenuePct: number | null;
  transactionsPct: number | null;
  avgTicketPct: number | null;
  /** null si alguno de los dos meses no tiene utilidad: un % sobre perdida no se lee bien. */
  netProfitPct: number | null;
  netProfitDiff: number;
  /** Puntos porcentuales; null si el mes anterior no tiene ingresos. */
  netMarginPp: number | null;
}

/** null cuando no hay base contra la cual comparar (antes daba un "0%" engañoso). */
function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function compareMonths(current: MonthPnL, previous: MonthPnL): MonthDeltas {
  return {
    revenuePct: pctChange(current.revenue, previous.revenue),
    transactionsPct: pctChange(current.transactions, previous.transactions),
    avgTicketPct: pctChange(current.avgTicket, previous.avgTicket),
    netProfitPct:
      current.netProfit > 0 && previous.netProfit > 0 ? pctChange(current.netProfit, previous.netProfit) : null,
    netProfitDiff: current.netProfit - previous.netProfit,
    netMarginPp: previous.revenue > 0 ? current.netMarginPct - previous.netMarginPct : null,
  };
}

// ─── Corte de datos ──────────────────────────────────────────────────────────

/**
 * Ultimo dia cerrado del que hay datos completos: el dia anterior al del ultimo
 * sync de ventas exitoso, y nunca despues de ayer (hoy no ha terminado).
 */
export function resolveDataCutoff(lastSyncAt: Date | null, yesterday: Date): Date {
  if (!lastSyncAt || lastSyncAt.getTime() <= 0) return yesterday;
  const lastComplete = addDays(colombiaDayOf(lastSyncAt), -1);
  return lastComplete < yesterday ? lastComplete : yesterday;
}

export async function getDataCutoff(): Promise<Date> {
  const state = await prisma.syncState.findUnique({
    where: { entity: "pos_order" },
    select: { lastSyncAt: true },
  });
  return resolveDataCutoff(state?.lastSyncAt ?? null, colombiaDaysAgo(1));
}

/** Cuantos dias del mes (desde el 1) quedan cubiertos por el corte. */
export function daysCoveredInMonth(year: number, month: number, cutoff: Date): number {
  const n = daysBetween(monthStart(year, month), cutoff) + 1;
  return Math.min(Math.max(n, 0), daysInMonth(year, month));
}

// ─── Ventana movil (punto de equilibrio y caja) ─────────────────────────────

export interface TrailingActivity {
  windowDays: number;
  /** Dias calendario de la ventana con historia (menos que `windowDays` si la historia es mas corta). */
  calendarDays: number;
  daysWithSales: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  transactions: number;
  /** Ingreso de cada dia con venta. */
  dailyRevenue: number[];
}

export function summarizeTrailing(
  rows: SnapshotTotals[],
  cutoff: Date,
  windowDays: number,
  firstDataDay: Date | null
): TrailingActivity {
  const windowStart = addDays(cutoff, -(windowDays - 1));
  const inWindow = rows.filter((r) => r.date >= windowStart && r.date <= cutoff);
  const historyStart = firstDataDay && firstDataDay > windowStart ? firstDataDay : windowStart;
  const calendarDays = firstDataDay
    ? Math.min(Math.max(daysBetween(historyStart, cutoff) + 1, 0), windowDays)
    : 0;
  const revenue = inWindow.reduce((s, r) => s + r.totalRevenue, 0);
  const cost = inWindow.reduce((s, r) => s + r.totalCost, 0);
  return {
    windowDays,
    calendarDays,
    daysWithSales: inWindow.length,
    revenue,
    cost,
    grossProfit: revenue - cost,
    transactions: inWindow.reduce((s, r) => s + r.transactionCount, 0),
    dailyRevenue: inWindow.map((r) => r.totalRevenue),
  };
}

export async function getTrailingActivity(cutoff: Date, windowDays = 30): Promise<TrailingActivity> {
  const [rows, first] = await Promise.all([
    prisma.financialSnapshot.findMany({
      where: { date: { gte: addDays(cutoff, -(windowDays - 1)), lte: cutoff } },
      select: { date: true, totalRevenue: true, totalCost: true, transactionCount: true },
    }),
    prisma.financialSnapshot.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  return summarizeTrailing(rows, cutoff, windowDays, first?.date ?? null);
}

// ─── Vista del mes ───────────────────────────────────────────────────────────

export type MonthStatus = "empty" | "in-progress" | "closed";

export interface CategoryCost {
  category: string;
  revenue: number;
  cost: number;
  grossProfit: number;
  marginPct: number;
  revenueSharePct: number;
  costSharePct: number;
}

export interface FinancialOverview {
  cutoff: Date;
  status: MonthStatus;
  current: MonthPnL;
  /** Mes anterior con los mismos dias que `current`: la comparacion justa. */
  previous: MonthPnL;
  previousFull: MonthPnL;
  deltas: MonthDeltas;
  /** Solo para un mes en curso. */
  projection: MonthEndProjection | null;
  /** Venta y costo reales por categoria en los dias cubiertos (CategorySnapshot). */
  categories: CategoryCost[];
}

export interface SummaryRow {
  concepto: string;
  valor: string | number;
}

/** Resumen del período en filas concepto/valor, para exportar. */
export function buildSummaryRows(o: FinancialOverview): SummaryRow[] {
  const { current: c, previous: p, projection } = o;
  const pesos = (v: number) => Math.round(v);
  const pct = (v: number) => Number(v.toFixed(1));
  const source =
    c.fixed.source === "budget"
      ? "Presupuesto del mes"
      : c.fixed.source === "inherited" && c.fixed.from
        ? `Heredado de ${formatMonthLabel(c.fixed.from.year, c.fixed.from.month)}`
        : "Sin presupuesto";

  const rows: SummaryRow[] = [
    { concepto: "Período", valor: c.label },
    { concepto: "Datos cerrados hasta", valor: isoDay(o.cutoff) },
    { concepto: "Días cubiertos", valor: `${c.daysElapsed} de ${c.daysInMonth}` },
    { concepto: "Días con venta", valor: c.daysWithSales },
    { concepto: "Ventas", valor: pesos(c.revenue) },
    { concepto: "Costo de mercancía", valor: pesos(c.cost) },
    { concepto: "Utilidad bruta", valor: pesos(c.grossProfit) },
    { concepto: "Margen bruto %", valor: pct(c.grossMarginPct) },
    { concepto: "Gastos fijos del mes", valor: pesos(c.fixed.monthly) },
    { concepto: "Origen de los gastos fijos", valor: source },
    { concepto: "Gastos fijos cargados al período", valor: pesos(c.fixedCharged) },
    { concepto: "Utilidad neta", valor: pesos(c.netProfit) },
    { concepto: "Margen neto %", valor: pct(c.netMarginPct) },
    { concepto: "Transacciones", valor: c.transactions },
    { concepto: "Ticket promedio", valor: pesos(c.avgTicket) },
  ];
  if (projection) {
    rows.push(
      { concepto: "Cierre proyectado · ventas", valor: pesos(projection.projectedRevenue) },
      { concepto: "Cierre proyectado · utilidad neta", valor: pesos(projection.projectedNetProfit) },
      { concepto: "Cierre proyectado · margen neto %", valor: pct(projection.projectedMarginPct) }
    );
  }
  const prevTag = `${p.label} (días 1-${p.daysElapsed})`;
  rows.push(
    { concepto: `${prevTag} · ventas`, valor: pesos(p.revenue) },
    { concepto: `${prevTag} · utilidad neta`, valor: pesos(p.netProfit) },
    { concepto: `${prevTag} · transacciones`, valor: p.transactions }
  );
  for (const item of c.fixed.items) {
    rows.push({ concepto: `Gasto fijo mensual · ${item.category}`, valor: pesos(item.amount) });
  }
  return rows;
}

export async function getFinancialOverview(year: number, month: number, cutoff?: Date): Promise<FinancialOverview> {
  const cut = cutoff ?? (await getDataCutoff());
  const prev = previousMonth(year, month);
  const elapsed = daysCoveredInMonth(year, month, cut);
  const prevElapsed = daysCoveredInMonth(prev.year, prev.month, cut);
  const start = monthStart(year, month);
  const coveredEnd = addDays(start, elapsed); // exclusivo

  const [snapshots, budgetRows, categoryRows] = await Promise.all([
    prisma.financialSnapshot.findMany({
      where: { date: { gte: monthStart(prev.year, prev.month), lt: coveredEnd } },
      select: { date: true, totalRevenue: true, totalCost: true, transactionCount: true },
    }),
    getBudgetRowsThrough(year, month),
    prisma.categorySnapshot.groupBy({
      by: ["category"],
      where: { date: { gte: start, lt: coveredEnd } },
      _sum: { revenue: true, cost: true },
    }),
  ]);

  const dim = daysInMonth(year, month);
  const status: MonthStatus = elapsed === 0 ? "empty" : elapsed < dim ? "in-progress" : "closed";
  const fixed = pickMonthBudget(budgetRows, year, month);
  const prevFixed = pickMonthBudget(budgetRows, prev.year, prev.month);

  const current = buildMonthPnL({ year, month, daysElapsed: elapsed, snapshots, fixed });
  const previousFull = buildMonthPnL({ ...prev, daysElapsed: prevElapsed, snapshots, fixed: prevFixed });
  const previous =
    status === "in-progress"
      ? buildMonthPnL({ ...prev, daysElapsed: Math.min(elapsed, prevElapsed), snapshots, fixed: prevFixed })
      : previousFull;

  const projection =
    status === "in-progress"
      ? computeMonthEndProjection({
          daysElapsed: elapsed,
          daysInMonth: dim,
          mtdRevenue: current.revenue,
          mtdCost: current.cost,
          fixedExpensesMonthly: fixed.monthly,
        })
      : null;

  const catRevenue = categoryRows.reduce((s, c) => s + (c._sum.revenue ?? 0), 0);
  const catCost = categoryRows.reduce((s, c) => s + (c._sum.cost ?? 0), 0);
  const categories: CategoryCost[] = categoryRows
    .map((c) => {
      const revenue = c._sum.revenue ?? 0;
      const cost = c._sum.cost ?? 0;
      return {
        category: c.category,
        revenue,
        cost,
        grossProfit: revenue - cost,
        marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0,
        revenueSharePct: catRevenue > 0 ? (revenue / catRevenue) * 100 : 0,
        costSharePct: catCost > 0 ? (cost / catCost) * 100 : 0,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  return {
    cutoff: cut,
    status,
    current,
    previous,
    previousFull,
    deltas: compareMonths(current, previous),
    projection,
    categories,
  };
}
