/**
 * Si el MES ACTUAL (Colombia) no tiene presupuestos, los hereda del mes más
 * reciente que sí tenga. Los gastos fijos se repiten mes a mes.
 *   tsx --env-file=.env.local scripts/carry-forward-budgets.ts
 */
import { prisma } from "@/lib/prisma";
import { colombiaYearMonthDay } from "@/lib/timezone";

async function main() {
  const { year, month } = colombiaYearMonthDay();
  const existing = await prisma.expenseBudget.count({ where: { month, year } });
  if (existing > 0) {
    console.log(`${year}-${String(month).padStart(2, "0")} ya tiene ${existing} presupuestos. Nada que hacer.`);
    process.exit(0);
  }
  const prior = await prisma.expenseBudget.findFirst({
    where: { OR: [{ year: { lt: year } }, { year, month: { lt: month } }] },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { month: true, year: true },
  });
  if (!prior) {
    console.log("No hay un mes previo con presupuestos para copiar.");
    process.exit(0);
  }
  const source = await prisma.expenseBudget.findMany({ where: { month: prior.month, year: prior.year } });
  const res = await prisma.expenseBudget.createMany({
    data: source.map((s) => ({
      category: s.category,
      month,
      year,
      budgetAmount: s.budgetAmount,
      alertPct: s.alertPct,
      actualAmount: 0,
    })),
    skipDuplicates: true,
  });
  console.log(`Copiados ${res.count} presupuestos de ${prior.year}-${String(prior.month).padStart(2, "0")} → ${year}-${String(month).padStart(2, "0")}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
