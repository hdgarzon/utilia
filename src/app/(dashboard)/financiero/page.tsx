export const dynamic = 'force-dynamic';

import { prisma } from "@/lib/prisma";
import { KPICard } from "@/components/dashboard/KPICard";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { MonthCompare } from "@/components/dashboard/MonthCompare";
import { BreakevenCard } from "@/components/dashboard/BreakevenCard";
import { CashFlowCard } from "@/components/dashboard/CashFlowCard";
import { getMonthComparison } from "@/lib/analytics/month-compare";
import { getBreakevenAnalysis } from "@/lib/analytics/breakeven";
import { getCashFlowAnalysis } from "@/lib/analytics/cash-flow";
import { formatCurrency } from "@/lib/utils";
import { DollarSign, TrendingUp, TrendingDown } from "lucide-react";
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

  const avgMargin = snapshots.length > 0
    ? snapshots.reduce((sum, s) => sum + s.netMarginPct, 0) / snapshots.length
    : 0;

  const chartData = snapshots.map((s) => ({
    label: new Date(s.date).toLocaleDateString("es-CO", { day: "2-digit", month: "short" }),
    amount: s.netProfit,
    transactions: s.transactionCount,
  }));

  return { totals, avgMargin, chartData, budgets };
}

export default async function FinancieroPage() {
  const fallbackTotals = { revenue: 0, cost: 0, profit: 0, expenses: 0, transactions: 0 };
  const [financial, monthCompare, breakeven, cashFlow] = await Promise.all([
    getFinancialData().catch(() => ({ totals: fallbackTotals, avgMargin: 0, chartData: [] as Awaited<ReturnType<typeof getFinancialData>>["chartData"], budgets: [] as Awaited<ReturnType<typeof getFinancialData>>["budgets"] })),
    getMonthComparison().catch(() => null),
    getBreakevenAnalysis().catch(() => null),
    getCashFlowAnalysis().catch(() => null),
  ]);
  const { totals = fallbackTotals, avgMargin, chartData, budgets } = financial;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Centro Financiero</h1>

      {cashFlow && <CashFlowCard data={cashFlow} />}

      {breakeven && <BreakevenCard data={breakeven} />}

      {monthCompare && <MonthCompare data={monthCompare} />}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KPICard title="Ingresos (mes)" value={formatCurrency(totals.revenue)} icon={DollarSign} variant="success" />
        <KPICard title="Utilidad Neta (mes)" value={formatCurrency(totals.profit)}
          variant={totals.profit > 0 ? "success" : "danger"} icon={TrendingUp} />
        <KPICard title="Margen Promedio" value={`${avgMargin.toFixed(1)}%`}
          variant={avgMargin >= 20 ? "success" : avgMargin >= 10 ? "warning" : "danger"} icon={TrendingUp} />
        <KPICard title="Gastos Fijos (mes)" value={formatCurrency(totals.expenses)} icon={TrendingDown} />
      </div>

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
