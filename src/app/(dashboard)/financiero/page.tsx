export const dynamic = 'force-dynamic';

import { prisma } from "@/lib/prisma";
import { KPICard } from "@/components/dashboard/KPICard";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { formatCurrency } from "@/lib/utils";
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { subDays } from "date-fns";

async function getFinancialData() {
  const last30 = subDays(new Date(), 30);
  const [snapshots, budgets] = await Promise.all([
    prisma.financialSnapshot.findMany({ where: { date: { gte: last30 } }, orderBy: { date: "asc" } }),
    prisma.expenseBudget.findMany({
      where: { year: new Date().getFullYear(), month: new Date().getMonth() + 1 },
    }),
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

  const lastSnapshot = snapshots[snapshots.length - 1];

  return { totals, avgMargin, chartData, budgets, cashBalance: lastSnapshot?.cashBalance ?? 0, projected30d: lastSnapshot?.projectedCash30d ?? 0 };
}

export default async function FinancieroPage() {
  const { totals, avgMargin, chartData, budgets, cashBalance, projected30d } = await getFinancialData();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Centro Financiero</h1>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KPICard title="Ingresos 30d" value={formatCurrency(totals.revenue)} icon={DollarSign} variant="success" />
        <KPICard title="Utilidad Neta 30d" value={formatCurrency(totals.profit)}
          variant={totals.profit > 0 ? "success" : "danger"} icon={TrendingUp} />
        <KPICard title="Margen Promedio" value={`${avgMargin.toFixed(1)}%`}
          variant={avgMargin >= 20 ? "success" : avgMargin >= 10 ? "warning" : "danger"} icon={TrendingUp} />
        <KPICard title="Gastos Fijos 30d" value={formatCurrency(totals.expenses)} icon={TrendingDown} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5 space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Saldo Actual</p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(cashBalance)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Proyección 30 Días</p>
          <p className={`text-2xl font-bold ${projected30d >= 0 ? "text-primary" : "text-destructive"}`}>
            {formatCurrency(projected30d)}
          </p>
          {projected30d < 0 && (
            <div className="flex items-center gap-1 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3" />
              Flujo de caja negativo proyectado
            </div>
          )}
        </div>
      </div>

      <SalesChart data={chartData} title="Utilidad Diaria — Últimos 30 Días" />

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
