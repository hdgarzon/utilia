export const dynamic = 'force-dynamic';

import { prisma } from "@/lib/prisma";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { MonthCompare } from "@/components/dashboard/MonthCompare";
import { BreakevenCard } from "@/components/dashboard/BreakevenCard";
import { CashFlowCard } from "@/components/dashboard/CashFlowCard";
import { getMonthComparison } from "@/lib/analytics/month-compare";
import { getBreakevenAnalysis } from "@/lib/analytics/breakeven";
import { getCashFlowAnalysis } from "@/lib/analytics/cash-flow";
import { formatCurrency } from "@/lib/utils";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { colombiaStartOfMonth, colombiaYearMonthDay } from "@/lib/timezone";

async function getFinancialData() {
  const { year, month } = colombiaYearMonthDay();
  const [snapshots, budgets] = await Promise.all([
    prisma.financialSnapshot.findMany({ where: { date: { gte: colombiaStartOfMonth() } }, orderBy: { date: "asc" } }),
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
    label: new Date(s.date).toLocaleDateString("es-CO", { day: "2-digit", month: "short" }),
    amount: s.netProfit,
    transactions: s.transactionCount,
  }));

  return { totals, netMarginPct, chartData, budgets };
}

export default async function FinancieroPage() {
  const fallbackTotals = { revenue: 0, cost: 0, profit: 0, expenses: 0 };
  const [financial, monthCompare, breakeven, cashFlow] = await Promise.all([
    getFinancialData().catch(() => ({ totals: fallbackTotals, netMarginPct: 0, chartData: [] as Awaited<ReturnType<typeof getFinancialData>>["chartData"], budgets: [] as Awaited<ReturnType<typeof getFinancialData>>["budgets"] })),
    getMonthComparison().catch(() => null),
    getBreakevenAnalysis().catch(() => null),
    getCashFlowAnalysis().catch(() => null),
  ]);
  const { totals = fallbackTotals, netMarginPct, chartData, budgets } = financial;

  // Veredicto "¿estamos ganando?" — semáforo honesto:
  //   pérdida (rojo) · margen < 10% (ámbar: ganas pero ajustado) · ≥ 10% (verde)
  const profitable = totals.profit > 0;
  const tier: "good" | "thin" | "loss" = !profitable ? "loss" : netMarginPct < 10 ? "thin" : "good";
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
      <h1 className="text-xl font-bold">Centro Financiero</h1>

      {/* Veredicto: responde "¿estamos ganando?" de un vistazo */}
      <div className={`rounded-xl border p-5 ${tone.border} ${tone.bg}`}>
        <div className="flex items-start gap-3">
          <VerdictIcon className={`h-6 w-6 mt-0.5 shrink-0 ${tone.text}`} />
          <div className="flex-1 space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">¿Estamos ganando este mes?</p>
            <p className={`text-lg font-bold ${tone.text}`}>{verdictTitle}</p>
            <p className={`text-3xl font-bold ${tone.text}`}>{formatCurrency(totals.profit)}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {profitable ? (
                <>De cada $100 que vendes, te quedan <span className="font-semibold text-foreground">${netMarginPct.toFixed(0)}</span> de utilidad neta (después de costos y gastos fijos).</>
              ) : (
                <>Por cada $100 que vendes, pierdes <span className="font-semibold text-destructive">${Math.abs(netMarginPct).toFixed(0)}</span> después de costos y gastos fijos.</>
              )}
              {monthDelta !== null && (
                <>
                  {" · "}
                  <span className={monthDelta >= 0 ? "text-primary font-medium" : "text-destructive font-medium"}>
                    {monthDelta >= 0 ? "▲" : "▼"} {Math.abs(monthDelta).toFixed(0)}%
                  </span>{" "}
                  vs mismo punto del mes pasado
                </>
              )}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border">
          <div>
            <p className="text-xs text-muted-foreground">Ingresos (mes)</p>
            <p className="text-sm font-semibold">{formatCurrency(totals.revenue)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gastos fijos (mes)</p>
            <p className="text-sm font-semibold">{formatCurrency(totals.expenses)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Margen neto</p>
            <p className={`text-sm font-semibold ${tone.text}`}>{netMarginPct.toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {breakeven && <BreakevenCard data={breakeven} />}

      {cashFlow && <CashFlowCard data={cashFlow} />}

      {monthCompare && <MonthCompare data={monthCompare} />}

      <SalesChart data={chartData} title="Utilidad Diaria — Mes Actual" />

      {budgets.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Presupuesto por Categoría — Mes Actual</h3>
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
