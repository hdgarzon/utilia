import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/odoo", () => ({ odoo: {} }));

import { computeBreakeven } from "./breakeven";
import type { TrailingActivity } from "./financial-month";

const trailing = (over: Partial<TrailingActivity> = {}): TrailingActivity => ({
  windowDays: 30,
  calendarDays: 30,
  daysWithSales: 27,
  revenue: 9_000_000,
  cost: 4_500_000,
  grossProfit: 4_500_000,
  transactions: 900,
  dailyRevenue: [],
  ...over,
});

describe("computeBreakeven", () => {
  it("los dias abiertos cubren tambien el gasto de los dias cerrados", () => {
    // $3M en 30 dias = $100k/dia; se abre el 90% → $111k por dia abierto;
    // con 50% de margen hay que vender $222k.
    const b = computeBreakeven({
      fixedExpensesMonthly: 3_000_000,
      daysInMonth: 30,
      trailing: trailing({ dailyRevenue: [300_000, 200_000, 250_000] }),
      today: { revenue: 111_111, transactions: 10, isLive: true },
    });
    expect(b.computable).toBe(true);
    expect(b.breakevenRevenue).toBeCloseTo(222_222, 0);
    expect(b.breakevenTransactions).toBe(23); // ticket $10.000
    expect(b.todayProgress).toBeCloseTo(0.5, 3);
    expect(b.daysAboveBreakeven).toBe(2);
  });

  it("sin presupuesto no reporta un equilibrio de $0", () => {
    const b = computeBreakeven({
      fixedExpensesMonthly: 0,
      daysInMonth: 31,
      trailing: trailing(),
      today: { revenue: 0, transactions: 0, isLive: false },
    });
    expect(b.computable).toBe(false);
    expect(b.breakevenRevenue).toBe(0);
  });
});
