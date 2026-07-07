export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { BudgetRow } from "./BudgetRow";
import { AddBudgetForm } from "./AddBudgetForm";
import { RecordExpense } from "./RecordExpense";
import { CloneBudgets } from "./CloneBudgets";
import { DollarSign, AlertCircle, Calendar } from "lucide-react";
import { getSelectedPeriod } from "@/lib/period";
import { recomputeMonthFixedExpenses } from "@/lib/snapshots";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default async function PresupuestosPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const params = await searchParams;
  const { month, year, isCurrentPeriod: isCurrentMonth } = await getSelectedPeriod(params);

  let budgets = await prisma.expenseBudget.findMany({
    where: { month, year },
    orderBy: { budgetAmount: "desc" },
  });

  // Permanencia: si el MES ACTUAL está vacío, hereda los gastos del mes más
  // reciente que sí tenga (los gastos fijos se repiten mes a mes). Cada mes nuevo
  // aparece poblado solo, sin tener que reingresar nada — y se pueden editar o
  // eliminar individualmente. Idempotente: createMany skipDuplicates + el unique
  // (category, month, year). Solo el mes actual, para no sembrar meses que se
  // naveguen a propósito.
  if (isCurrentMonth && budgets.length === 0) {
    const prior = await prisma.expenseBudget.findFirst({
      where: { OR: [{ year: { lt: year } }, { year, month: { lt: month } }] },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { month: true, year: true },
    });
    if (prior) {
      const source = await prisma.expenseBudget.findMany({
        where: { month: prior.month, year: prior.year },
      });
      await prisma.expenseBudget.createMany({
        data: source.map((s) => ({
          category: s.category,
          month,
          year,
          budgetAmount: s.budgetAmount,
          alertPct: s.alertPct,
          actualAmount: 0, // mes nuevo arranca sin ejecutado
        })),
        skipDuplicates: true,
      });
      // Los snapshots del mes pudieron crearse antes de existir el presupuesto
      // (gasto fijo en 0). Recalcular para que utilidad/margen sean coherentes.
      await recomputeMonthFixedExpenses(year, month);
      budgets = await prisma.expenseBudget.findMany({
        where: { month, year },
        orderBy: { budgetAmount: "desc" },
      });
    }
  }

  const totalBudget = budgets.reduce((s, b) => s + b.budgetAmount, 0);
  const totalActual = budgets.reduce((s, b) => s + b.actualAmount, 0);
  const totalPct = totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0;
  const daysInMonth = new Date(year, month, 0).getDate();
  const fixedPerDay = totalBudget / daysInMonth;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Presupuestos</h1>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <Calendar className="h-3 w-3" />
            {MONTHS[month - 1]} {year}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {budgets.length > 0 && <CloneBudgets currentMonth={month} currentYear={year} />}
          <AddBudgetForm month={month} year={year} />
        </div>
      </div>

      <RecordExpense budgets={budgets.map((b) => ({ id: b.id, category: b.category }))} />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Presupuesto Total</p>
          <p className="text-2xl font-bold">{formatCurrency(totalBudget)}</p>
          <p className="text-xs text-muted-foreground">{budgets.length} categorías</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Ejecutado</p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(totalActual)}</p>
          <p className="text-xs text-muted-foreground">{totalPct.toFixed(1)}% del total</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Disponible</p>
          <p className={`text-2xl font-bold ${totalBudget - totalActual < 0 ? "text-destructive" : "text-foreground"}`}>
            {formatCurrency(totalBudget - totalActual)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Gasto/día (prorrateo)</p>
          <p className="text-2xl font-bold">{formatCurrency(fixedPerDay)}</p>
          <p className="text-xs text-muted-foreground">{daysInMonth} días del mes</p>
        </div>
      </div>

      {/* Tabla editable */}
      {budgets.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center space-y-3">
          <DollarSign className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">Sin presupuestos para {MONTHS[month - 1]} {year}</p>
          <p className="text-xs text-muted-foreground">Agregá una categoría arriba para empezar.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 md:px-5 py-3 border-b border-border flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Detalle por Categoría</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground bg-secondary/30">
                  <th className="px-4 py-2.5 text-left font-medium">Categoría</th>
                  <th className="px-4 py-2.5 text-right font-medium">Presupuesto</th>
                  <th className="px-4 py-2.5 text-right font-medium">Ejecutado</th>
                  <th className="px-4 py-2.5 text-left font-medium">Avance</th>
                  <th className="px-4 py-2.5 text-right font-medium">Alerta a</th>
                  <th className="px-4 py-2.5 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <BudgetRow key={b.id} budget={b} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Nota informativa */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
          <p><strong className="text-foreground">Cómo se usa el presupuesto:</strong> el sync de ventas prorratea automáticamente el total mensual entre los días del mes para calcular tu utilidad neta diaria en el Centro Financiero.</p>
          <p>El campo &quot;Ejecutado&quot; se actualiza manualmente — para auto-tracking de gastos reales necesitaríamos conectar al módulo Accounting de Odoo o un input manual.</p>
        </div>
      </div>
    </div>
  );
}
