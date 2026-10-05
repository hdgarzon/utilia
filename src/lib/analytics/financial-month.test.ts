import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  buildMonthPnL,
  buildSummaryRows,
  compareMonths,
  daysCoveredInMonth,
  resolveDataCutoff,
  summarizeTrailing,
  type SnapshotTotals,
} from "./financial-month";
import { computeMonthEndProjection } from "./month-projection";
import type { MonthFixedExpenses } from "@/lib/fixed-expenses";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const snap = (iso: string, totalRevenue: number, totalCost: number, transactionCount = 10): SnapshotTotals => ({
  date: day(iso),
  totalRevenue,
  totalCost,
  transactionCount,
});
const fixed = (monthly: number): MonthFixedExpenses => ({
  monthly,
  source: "budget",
  from: null,
  items: [{ category: "Arriendo", amount: monthly }],
});

describe("buildMonthPnL", () => {
  // Octubre: 31 dias, $3.100.000 de gasto fijo → $100.000 por dia calendario.
  const october = [
    snap("2026-10-01", 500_000, 250_000),
    snap("2026-10-02", 400_000, 200_000),
    snap("2026-10-03", 300_000, 150_000),
    // 4 de octubre: domingo cerrado, sin snapshot.
  ];

  it("un dia cerrado tambien carga gasto fijo", () => {
    const pnl = buildMonthPnL({ year: 2026, month: 10, daysElapsed: 4, snapshots: october, fixed: fixed(3_100_000) });
    expect(pnl.days).toHaveLength(4);
    expect(pnl.daysWithSales).toBe(3);
    expect(pnl.fixedCharged).toBeCloseTo(400_000);
    expect(pnl.grossProfit).toBe(600_000);
    expect(pnl.netProfit).toBeCloseTo(200_000);
    expect(pnl.days[3]).toMatchObject({ date: "2026-10-04", revenue: 0, transactions: 0 });
    expect(pnl.days[3].netProfit).toBeCloseTo(-100_000);
  });

  it("no cuenta snapshots despues del corte ni de otro mes", () => {
    const withExtras = [
      snap("2026-09-30", 9_000_000, 1),
      ...october,
      snap("2026-10-05", 9_000_000, 1), // hoy, parcial
    ];
    const pnl = buildMonthPnL({ year: 2026, month: 10, daysElapsed: 4, snapshots: withExtras, fixed: fixed(0) });
    expect(pnl.revenue).toBe(1_200_000);
  });

  it("el margen es el agregado del periodo, no el promedio de los diarios", () => {
    const pnl = buildMonthPnL({
      year: 2026,
      month: 10,
      daysElapsed: 2,
      snapshots: [snap("2026-10-01", 1_000_000, 500_000), snap("2026-10-02", 100_000, 90_000)],
      fixed: fixed(0),
    });
    // (500k + 10k) / 1,1M = 46,4%; el promedio de 50% y 10% daria 30%.
    expect(pnl.grossMarginPct).toBeCloseTo(46.36, 1);
  });

  it("un mes cerrado carga el presupuesto completo", () => {
    const pnl = buildMonthPnL({ year: 2026, month: 9, daysElapsed: 30, snapshots: [], fixed: fixed(6_000_000) });
    expect(pnl.fixedCharged).toBeCloseTo(6_000_000);
    expect(pnl.netProfit).toBeCloseTo(-6_000_000);
  });
});

describe("proyeccion de cierre", () => {
  it("con el gasto fijo por dia calendario, el margen proyectado es el margen real", () => {
    const snapshots = [snap("2026-10-01", 700_000, 350_000), snap("2026-10-02", 650_000, 330_000)];
    const pnl = buildMonthPnL({ year: 2026, month: 10, daysElapsed: 3, snapshots, fixed: fixed(6_200_000) });
    const projection = computeMonthEndProjection({
      daysElapsed: pnl.daysElapsed,
      daysInMonth: pnl.daysInMonth,
      mtdRevenue: pnl.revenue,
      mtdCost: pnl.cost,
      fixedExpensesMonthly: pnl.fixed.monthly,
    });
    expect(projection.projectedMarginPct).toBeCloseTo(pnl.netMarginPct, 6);
    // El dia 3 sin venta cuenta como cero: 1,35M en 3 dias → 450k/dia × 31.
    expect(projection.projectedRevenue).toBeCloseTo(13_950_000);
  });
});

describe("compareMonths", () => {
  const base = (revenue: number, cost: number, monthly: number) =>
    buildMonthPnL({
      year: 2026,
      month: 9,
      daysElapsed: 1,
      snapshots: revenue > 0 ? [snap("2026-09-01", revenue, cost)] : [],
      fixed: fixed(monthly),
    });

  it("sin ventas en el mes anterior no inventa un 0%", () => {
    const d = compareMonths(base(500_000, 200_000, 0), base(0, 0, 0));
    expect(d.revenuePct).toBeNull();
    expect(d.netMarginPp).toBeNull();
  });

  it("con perdida de por medio, el cambio de utilidad queda en pesos", () => {
    // Septiembre: 30 dias, $3.000.000 → $100.000 por dia.
    const loss = base(150_000, 100_000, 3_000_000); // utilidad bruta 50k − 100k = −50k
    const gain = base(500_000, 200_000, 3_000_000); // 300k − 100k = 200k
    const d = compareMonths(gain, loss);
    expect(d.netProfitPct).toBeNull();
    expect(d.netProfitDiff).toBeCloseTo(250_000);
  });
});

describe("corte de datos", () => {
  const yesterday = day("2026-10-04");

  it("el sync de la madrugada deja cerrado el dia anterior", () => {
    // 2026-10-05 05:16 Colombia = 10:16 UTC.
    expect(resolveDataCutoff(new Date("2026-10-05T10:16:00.000Z"), yesterday)).toEqual(yesterday);
  });

  it("un sync manual a media tarde no vuelve completo el dia de hoy", () => {
    expect(resolveDataCutoff(new Date("2026-10-05T19:00:00.000Z"), yesterday)).toEqual(yesterday);
  });

  it("si el sync lleva dias sin correr, el corte se queda en el ultimo dia completo", () => {
    // Ultimo sync: 2 de octubre a las 5am → completo hasta el 1.
    expect(resolveDataCutoff(new Date("2026-10-02T10:16:00.000Z"), yesterday)).toEqual(day("2026-10-01"));
  });

  it("sin sync previo usa ayer", () => {
    expect(resolveDataCutoff(null, yesterday)).toEqual(yesterday);
    expect(resolveDataCutoff(new Date(0), yesterday)).toEqual(yesterday);
  });

  it("dias cubiertos por mes segun el corte", () => {
    const cutoff = day("2026-10-04");
    expect(daysCoveredInMonth(2026, 10, cutoff)).toBe(4);
    expect(daysCoveredInMonth(2026, 9, cutoff)).toBe(30);
    expect(daysCoveredInMonth(2026, 11, cutoff)).toBe(0);
  });
});

describe("summarizeTrailing", () => {
  it("con historia mas corta que la ventana, solo cuenta los dias con historia", () => {
    const cutoff = day("2026-10-04");
    const rows = [snap("2026-09-25", 100, 50), snap("2026-10-04", 300, 100)];
    const t = summarizeTrailing(rows, cutoff, 30, day("2026-09-25"));
    expect(t.calendarDays).toBe(10);
    expect(t.daysWithSales).toBe(2);
    expect(t.grossProfit).toBe(250);
  });

  it("descarta filas fuera de la ventana", () => {
    const cutoff = day("2026-10-04");
    const rows = [snap("2026-08-01", 999, 0), snap("2026-10-04", 300, 100)];
    const t = summarizeTrailing(rows, cutoff, 30, day("2026-01-01"));
    expect(t.calendarDays).toBe(30);
    expect(t.revenue).toBe(300);
  });
});

describe("buildSummaryRows", () => {
  it("dice de donde sale el gasto fijo cuando es heredado", () => {
    const current = buildMonthPnL({
      year: 2026,
      month: 10,
      daysElapsed: 1,
      snapshots: [snap("2026-10-01", 100, 50)],
      fixed: { monthly: 3_100, source: "inherited", from: { year: 2026, month: 8 }, items: [] },
    });
    const previous = buildMonthPnL({ year: 2026, month: 9, daysElapsed: 1, snapshots: [], fixed: fixed(0) });
    const rows = buildSummaryRows({
      cutoff: day("2026-10-01"),
      status: "in-progress",
      current,
      previous,
      previousFull: previous,
      deltas: compareMonths(current, previous),
      projection: null,
      categories: [],
    });
    expect(rows).toContainEqual({ concepto: "Origen de los gastos fijos", valor: "Heredado de Agosto 2026" });
    expect(rows).toContainEqual({ concepto: "Gastos fijos cargados al período", valor: 100 });
  });
});
