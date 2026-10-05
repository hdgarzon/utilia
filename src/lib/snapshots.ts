import { prisma } from "@/lib/prisma";
import { getMonthFixedExpenses } from "@/lib/fixed-expenses";
import { addDays, daysInMonth, isoDay, monthStart } from "@/lib/timezone";

/**
 * Recalcula, para todos los snapshots diarios de un mes, los gastos fijos
 * prorrateados, la utilidad neta y el margen — a partir del PRESUPUESTO VIGENTE
 * de ese mes (el propio o, si no tiene, el heredado; ver fixed-expenses.ts).
 *
 * Por qué: FinancialSnapshot guarda `fixedExpenses` denormalizado en el momento
 * del sync. Si el presupuesto se crea o edita DESPUÉS (o el mes se sembró antes
 * de tener presupuesto), los snapshots quedan con gastos fijos viejos — o en 0 —
 * y las vistas que leen esas columnas (patrón semanal) mienten. Hay que llamar
 * a esto después de cualquier cambio de presupuesto (crear/editar/eliminar/
 * clonar/heredar).
 *
 * El Centro Financiero no lee estas columnas: calcula el gasto fijo por día
 * calendario desde el presupuesto (financial-month.ts).
 *
 * grossProfit (= ingresos − costo) ya está bien en el snapshot; solo recalculamos
 * lo que depende del gasto fijo.
 */
export async function recomputeMonthFixedExpenses(year: number, month: number) {
  const { monthly } = await getMonthFixedExpenses(year, month);
  const perDay = monthly / daysInMonth(year, month);

  const start = monthStart(year, month);
  const startStr = isoDay(start);
  const endStr = isoDay(addDays(start, daysInMonth(year, month)));

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
