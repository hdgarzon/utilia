import { prisma } from "@/lib/prisma";

/**
 * Recalcula, para todos los snapshots diarios de un mes, los gastos fijos
 * prorrateados, la utilidad neta y el margen — a partir del PRESUPUESTO ACTUAL
 * de ese mes.
 *
 * Por qué: FinancialSnapshot guarda `fixedExpenses` denormalizado en el momento
 * del sync. Si el presupuesto se crea o edita DESPUÉS (o el mes se sembró antes
 * de tener presupuesto), los snapshots quedan con gastos fijos viejos — o en 0 —
 * y entonces utilidad/margen mienten. Hay que llamar a esto después de cualquier
 * cambio de presupuesto (crear/editar/eliminar/clonar/heredar).
 *
 * grossProfit (= ingresos − costo) ya está bien en el snapshot; solo recalculamos
 * lo que depende del gasto fijo.
 */
export async function recomputeMonthFixedExpenses(year: number, month: number) {
  const budgets = await prisma.expenseBudget.findMany({ where: { year, month } });
  const totalMonthly = budgets.reduce((s, b) => s + b.budgetAmount, 0);
  const daysInMonth = new Date(year, month, 0).getDate();
  const perDay = totalMonthly / daysInMonth;

  const startStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endStr = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

  await prisma.$executeRaw`
    UPDATE "FinancialSnapshot"
    SET "fixedExpenses" = ${perDay},
        "netProfit"     = "grossProfit" - ${perDay},
        "netMarginPct"  = CASE WHEN "totalRevenue" > 0
          THEN (("grossProfit" - ${perDay}) / "totalRevenue") * 100
          ELSE 0 END
    WHERE "date" >= ${startStr}::date AND "date" < ${endStr}::date
  `;
}
