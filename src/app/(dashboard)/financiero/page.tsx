export const dynamic = 'force-dynamic';

import { prisma } from "@/lib/prisma";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { MonthCompare } from "@/components/dashboard/MonthCompare";
import { BreakevenCard } from "@/components/dashboard/BreakevenCard";
import { CashFlowCard } from "@/components/dashboard/CashFlowCard";
import { WaterfallCard } from "@/components/dashboard/WaterfallCard";
import { getMonthComparison } from "@/lib/analytics/month-compare";
import { getBreakevenAnalysis } from "@/lib/analytics/breakeven";
import { getCashFlowAnalysis } from "@/lib/analytics/cash-flow";
import { getRevenueWaterfall } from "@/lib/analytics/revenue-waterfall";
import { computeMonthEndProjection, type MonthEndProjection } from "@/lib/analytics/month-projection";
import { formatCurrency } from "@/lib/utils";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { getSelectedPeriod } from "@/lib/period";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

async function getFinancialData(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const [snapshots, budgets] = await Promise.all([
    prisma.financialSnapshot.findMany({ where: { date: { gte: start, lt: end } }, orderBy: { date: "asc" } }),
    prisma.expenseBudget.findMany({ where: { year, month } }),
  ]);

  const totals = snapshots.reduce(
    (acc, s) => ({
      revenue: acc.revenue + s.totalRevenue,
      cost: acc.cost + s.totalCost,
      profit: acc.profit + s.netProfit,
      expenses: acc.expenses + s.fixedExpenses,
    }),
    { revenue: 0, cost: 0, profit: 0, expenses: 0 }
  );

  // Margen agregado del mes (utilidad total / ingresos totales). NO el promedio
  // de los % diarios: promediar porcentajes sobreponderaría los días flojos y
  // daba cifras engañosas (ej. −9% cuando en total sí hubo utilidad).
  const netMarginPct = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;

  const chartData = snapshots.map((s) => ({
    // date es DATE puro (medianoche UTC): formatear en UTC o el día se corre hacia atrás en servidores ≠ UTC
    label: new Date(s.date).toLocaleDateString("es-CO", { day: "2-digit", month: "short", timeZone: "UTC" }),
    amount: s.netProfit,
    transactions: s.transactionCount,
  }));

  // Proyección de cierre de mes reutilizando snapshots/budgets ya cargados
  // arriba — sin disparar otra consulta concurrente (el pool de conexiones es
  // compartido con breakeven/cashFlow/monthCompare en el mismo Promise.all).
  const daysInMonth = new Date(year, month, 0).getDate();
  const fixedExpensesMonthly = budgets.reduce((s, b) => s + b.budgetAmount, 0);
  const projection = computeMonthEndProjection({
    daysElapsed: snapshots.length,
    daysInMonth,
    mtdRevenue: totals.revenue,
    mtdCost: totals.cost,
    fixedExpensesMonthly,
  });

  return { totals, netMarginPct, chartData, budgets, projection };
}

export default async function FinancieroPage() {
  const { month, year, isCurrentPeriod } = await getSelectedPeriod();
  const periodLabel = `${MONTHS[month - 1]} ${year}`;

  const fallbackTotals = { revenue: 0, cost: 0, profit: 0, expenses: 0 };
  const [financial, monthCompare, breakeven, cashFlow, waterfall] = await Promise.all([
    getFinancialData(year, month).catch(() => ({ totals: fallbackTotals, netMarginPct: 0, chartData: [] as Awaited<ReturnType<typeof getFinancialData>>["chartData"], budgets: [] as Awaited<ReturnType<typeof getFinancialData>>["budgets"], projection: null as MonthEndProjection | null })),
    getMonthComparison(year, month).catch(() => null),
    getBreakevenAnalysis().catch(() => null),
    getCashFlowAnalysis().catch(() => null),
    getRevenueWaterfall(year, month).catch(() => null),
  ]);
  const { totals = fallbackTotals, netMarginPct, chartData, budgets, projection } = financial;

  // Los primeros días del mes, la utilidad MTD cruda casi siempre se ve en
  // pérdida (pocos días de ingresos contra gastos fijos ya prorrateados) sin
  // que nada esté mal. Con pocos días de historia, el veredicto responde
  // "a este ritmo, ¿cómo cerrarías?" en vez de juzgar sobre datos parciales.
  // Solo aplica al mes real en curso — un mes pasado ya cerrado no se "proyecta".
  const useProjection = isCurrentPeriod && projection !== null && projection.lowConfidence && projection.daysElapsed > 0;
  const headlineProfit = useProjection ? projection!.projectedNetProfit : totals.profit;
  const headlineMarginPct = useProjection ? projection!.projectedMarginPct : netMarginPct;

  // Veredicto "¿estamos ganando?" — semáforo honesto:
  //   pérdida (rojo) · margen < 10% (ámbar: ganas pero ajustado) · ≥ 10% (verde)
  const profitable = headlineProfit > 0;
  const tier: "good" | "thin" | "loss" = !profitable ? "loss" : headlineMarginPct < 10 ? "thin" : "good";
  const tone =
    tier === "good"
      ? { text: "text-primary", bg: "bg-primary/5", border: "border-primary/40" }
      : tier === "thin"
        ? { text: "text-warning", bg: "bg-warning/5", border: "border-warning/40" }
        : { text: "text-destructive", bg: "bg-destructive/5", border: "border-destructive/40" };
  const VerdictIcon = tier === "good" ? CheckCircle2 : tier === "loss" ? TrendingDown : AlertTriangle;
  const verdictTitle = tier === "good" ? "Sí, vas ganando" : tier === "thin" ? "Vas ganando, pero ajustado" : "Estás en pérdida este mes";
  const monthDelta = monthCompare?.deltas.netProfit ?? null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">
        Centro Financiero{!isCurrentPeriod && <span className="text-muted-foreground font-normal"> — {periodLabel}</span>}
      </h1>

      {/* Veredicto: responde "¿estamos ganando?" de un vistazo */}
      <div className={`rounded-xl border p-5 ${tone.border} ${tone.bg}`}>
        <div className="flex items-start gap-3">
          <VerdictIcon className={`h-6 w-6 mt-0.5 shrink-0 ${tone.text}`} />
          <div className="flex-1 space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              {useProjection ? "¿Cómo cerrarías el mes a este ritmo?" : "¿Estamos ganando este mes?"}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-lg font-bold ${tone.text}`}>{verdictTitle}</p>
              {useProjection && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  proyectado
                </span>
              )}
            </div>
            <p className={`text-3xl font-bold ${tone.text}`}>{formatCurrency(headlineProfit)}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {profitable ? (
                <>De cada $100 que vendes, {useProjection ? "quedarían" : "te quedan"} <span className="font-semibold text-foreground">${headlineMarginPct.toFixed(0)}</span> de utilidad neta (después de costos y gastos fijos).</>
              ) : (
                <>Por cada $100 que vendes, {useProjection ? "proyectas perder" : "pierdes"} <span className="font-semibold text-destructive">${Math.abs(headlineMarginPct).toFixed(0)}</span> después de costos y gastos fijos.</>
              )}
              {!useProjection && monthDelta !== null && (
                <>
                  {" · "}
                  <span className={monthDelta >= 0 ? "text-primary font-medium" : "text-destructive font-medium"}>
                    {monthDelta >= 0 ? "▲" : "▼"} {Math.abs(monthDelta).toFixed(0)}%
                  </span>{" "}
                  vs mismo punto del mes pasado
                </>
              )}
            </p>
            {useProjection && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Proyección con tu ritmo de estos {projection!.daysElapsed} día{projection!.daysElapsed !== 1 ? "s" : ""} · llevas{" "}
                <span className="font-medium text-foreground">{formatCurrency(totals.revenue)}</span> reales · faltan {projection!.daysRemaining} días para cerrar el mes.
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border">
          <div>
            <p className="text-xs text-muted-foreground">{useProjection ? "Ingresos (MTD real)" : "Ingresos (mes)"}</p>
            <p className="text-sm font-semibold">{formatCurrency(totals.revenue)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gastos fijos (mes)</p>
            <p className="text-sm font-semibold">{formatCurrency(useProjection ? projection!.fixedExpensesMonthly : totals.expenses)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{useProjection ? "Margen (MTD real)" : "Margen neto"}</p>
            <p className={`text-sm font-semibold ${tone.text}`}>{netMarginPct.toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {waterfall && (
        <WaterfallCard
          data={waterfall}
          categoryBreakdownNote={!isCurrentPeriod ? "Desglose por categoría basado en velocidad de venta actual, no en datos históricos de este mes." : undefined}
        />
      )}

      {breakeven && (
        <div className="space-y-2">
          {!isCurrentPeriod && (
            <p className="text-xs text-muted-foreground italic">Este punto de equilibrio es de hoy, no de {periodLabel}.</p>
          )}
          <BreakevenCard data={breakeven} />
        </div>
      )}

      {cashFlow && (
        <div className="space-y-2">
          {!isCurrentPeriod && (
            <p className="text-xs text-muted-foreground italic">Este flujo de caja es de ahora mismo, no de {periodLabel}.</p>
          )}
          <CashFlowCard data={cashFlow} />
        </div>
      )}

      {monthCompare && <MonthCompare data={monthCompare} isCurrentPeriod={isCurrentPeriod} />}

      <SalesChart data={chartData} title={isCurrentPeriod ? "Utilidad Diaria — Mes Actual" : `Utilidad Diaria — ${periodLabel}`} />

      {budgets.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
          <h3 className="text-sm font-semibold">Presupuesto por Categoría — {isCurrentPeriod ? "Mes Actual" : periodLabel}</h3>
          <div className="space-y-3">
            {budgets.map((b) => {
              const pct = b.budgetAmount > 0 ? (b.actualAmount / b.budgetAmount) * 100 : 0;
              const isAlert = pct >= b.alertPct;
              const isOver = pct >= 100;
              return (
                <div key={b.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{b.category}</span>
                    <span className={isOver ? "text-destructive font-semibold" : isAlert ? "text-warning" : "text-muted-foreground"}>
                      {formatCurrency(b.actualAmount)} / {formatCurrency(b.budgetAmount)} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isOver ? "bg-destructive" : isAlert ? "bg-warning" : "bg-primary"}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
