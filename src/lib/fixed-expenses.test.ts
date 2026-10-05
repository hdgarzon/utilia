import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { pickMonthBudget, type BudgetRow } from "./fixed-expenses";

const row = (year: number, month: number, category: string, budgetAmount: number): BudgetRow => ({
  year,
  month,
  category,
  budgetAmount,
});

const rows: BudgetRow[] = [
  row(2026, 7, "Arriendo", 2_000_000),
  row(2026, 8, "Arriendo", 2_500_000),
  row(2026, 8, "Nomina", 3_000_000),
  row(2026, 11, "Arriendo", 9_999_999),
];

describe("pickMonthBudget", () => {
  it("usa el presupuesto propio del mes cuando existe", () => {
    const r = pickMonthBudget(rows, 2026, 8);
    expect(r.source).toBe("budget");
    expect(r.monthly).toBe(5_500_000);
    expect(r.from).toBeNull();
    expect(r.items.map((i) => i.category)).toEqual(["Nomina", "Arriendo"]);
  });

  it("un mes sin presupuesto hereda el anterior mas reciente, no el primero", () => {
    // Octubre no tiene filas: debe tomar agosto, no julio.
    const r = pickMonthBudget(rows, 2026, 10);
    expect(r.source).toBe("inherited");
    expect(r.from).toEqual({ year: 2026, month: 8 });
    expect(r.monthly).toBe(5_500_000);
  });

  it("nunca hereda de un mes posterior", () => {
    expect(pickMonthBudget(rows, 2026, 10).monthly).not.toBe(9_999_999);
  });

  it("antes del primer presupuesto no inventa gasto fijo", () => {
    const r = pickMonthBudget(rows, 2026, 3);
    expect(r).toEqual({ monthly: 0, source: "none", from: null, items: [] });
  });

  it("hereda tambien a traves del cambio de año", () => {
    const r = pickMonthBudget([row(2026, 12, "Arriendo", 1_000)], 2027, 2);
    expect(r.source).toBe("inherited");
    expect(r.from).toEqual({ year: 2026, month: 12 });
  });
});
