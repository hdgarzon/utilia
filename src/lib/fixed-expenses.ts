import { prisma } from "@/lib/prisma";

/**
 * Gasto fijo mensual a partir del presupuesto (ExpenseBudget).
 *
 * Los gastos fijos se repiten mes a mes, pero el presupuesto de un mes solo se
 * crea cuando alguien abre Presupuestos durante ese mes. Si nadie lo abrio, el
 * mes queda sin filas y todo calculo que lea "presupuesto = 0" reporta la
 * utilidad bruta como si fuera neta: el negocio parece ganar el doble.
 *
 * Por eso un mes sin presupuesto propio hereda el del mes anterior mas reciente
 * que si lo tenga, y lo dice (`source: "inherited"`) para que la UI lo muestre.
 * Solo si nunca hubo presupuesto se reporta `source: "none"`.
 */

export type FixedExpenseSource = "budget" | "inherited" | "none";

export interface FixedExpenseItem {
  category: string;
  amount: number;
}

export interface MonthFixedExpenses {
  monthly: number;
  source: FixedExpenseSource;
  /** Mes del que se tomo el presupuesto cuando `source` es "inherited". */
  from: { year: number; month: number } | null;
  /** Conceptos del presupuesto usado, de mayor a menor. */
  items: FixedExpenseItem[];
}

export interface BudgetRow {
  year: number;
  month: number;
  category: string;
  budgetAmount: number;
}

const monthIndex = (year: number, month: number) => year * 12 + month;

/** Presupuesto aplicable a (year, month): el propio, o el ultimo anterior. */
export function pickMonthBudget(rows: BudgetRow[], year: number, month: number): MonthFixedExpenses {
  const target = monthIndex(year, month);
  let chosen: number | null = null;
  for (const r of rows) {
    const k = monthIndex(r.year, r.month);
    if (k <= target && (chosen === null || k > chosen)) chosen = k;
  }
  if (chosen === null) return { monthly: 0, source: "none", from: null, items: [] };

  const monthRows = rows.filter((r) => monthIndex(r.year, r.month) === chosen);
  const items = monthRows
    .map((r) => ({ category: r.category, amount: r.budgetAmount }))
    .sort((a, b) => b.amount - a.amount);
  const own = chosen === target;
  return {
    monthly: items.reduce((s, i) => s + i.amount, 0),
    source: own ? "budget" : "inherited",
    from: own ? null : { year: monthRows[0].year, month: monthRows[0].month },
    items,
  };
}

/** Filas de presupuesto hasta (year, month) inclusive, para resolver varios meses con una consulta. */
export async function getBudgetRowsThrough(year: number, month: number): Promise<BudgetRow[]> {
  return prisma.expenseBudget.findMany({
    where: { OR: [{ year: { lt: year } }, { year, month: { lte: month } }] },
    select: { year: true, month: true, category: true, budgetAmount: true },
  });
}

export async function getMonthFixedExpenses(year: number, month: number): Promise<MonthFixedExpenses> {
  return pickMonthBudget(await getBudgetRowsThrough(year, month), year, month);
}
