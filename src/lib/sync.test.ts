/**
 * El ingreso que guarda el snapshot financiero es la base sin IVA. Con precios
 * IVA incluido en el POS, `amount_total` trae el impuesto: sumarlo inflaba la
 * venta gravada ~16% y dejaba el margen bruto falso.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRaw = vi.fn(async (..._args: unknown[]) => 0);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    productInsight: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/fixed-expenses", () => ({
  getMonthFixedExpenses: vi.fn(async () => ({ monthly: 0 })),
}));
vi.mock("@/lib/analytics/stock-levels", () => ({ recomputeStockLevels: vi.fn() }));
vi.mock("@/lib/analytics/customers", () => ({ saveCustomerCapture: vi.fn() }));

const getPosOrdersBetween = vi.fn();
const getPosOrderLines = vi.fn();
vi.mock("@/lib/odoo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./odoo")>();
  return {
    ...actual,
    odoo: {
      getPosOrdersBetween: (...a: unknown[]) => getPosOrdersBetween(...a),
      getPosOrderLines: (...a: unknown[]) => getPosOrderLines(...a),
      getProductsByIds: vi.fn(async () => []),
    },
  };
});

import { posOrderRevenue } from "./odoo";
import { backfillSalesHistory, buildSnapshotRows } from "./sync";

// 2026-10-15 15:00 UTC = 10:00 en Colombia. Datos falsos.
const DATE = "2026-10-15 15:00:00";

function posOrder(id: number, amount_total: number, amount_tax: number) {
  return {
    id,
    name: `Orden Demo ${id}`,
    date_order: DATE,
    amount_total,
    amount_tax,
    amount_paid: amount_total,
    state: "paid",
    partner_id: false,
    lines: [],
    session_id: [1, "Caja Demo"],
  };
}

function posLine(orderId: number, price_subtotal: number, total_cost: number) {
  return {
    id: orderId * 10,
    order_id: [orderId, `Orden Demo ${orderId}`],
    product_id: [500 + orderId, "Producto Demo"],
    qty: 1,
    price_unit: price_subtotal,
    price_subtotal,
    discount: 0,
    total_cost,
  };
}

beforeEach(() => {
  executeRaw.mockClear();
  getPosOrdersBetween.mockReset();
  getPosOrderLines.mockReset();
});

describe("posOrderRevenue", () => {
  it("devuelve la base sin IVA de una orden con impuesto", () => {
    expect(posOrderRevenue({ amount_total: 11_900, amount_tax: 1_900 })).toBe(10_000);
  });

  it("una orden sin impuesto queda igual", () => {
    expect(posOrderRevenue({ amount_total: 5_000, amount_tax: 0 })).toBe(5_000);
  });
});

describe("buildSnapshotRows", () => {
  it("el ingreso, el ticket y el margen del dia salen de la base sin IVA", async () => {
    const orders = [posOrder(1, 11_900, 1_900), posOrder(2, 5_000, 0)].map((o) => ({
      id: o.id,
      date_order: o.date_order,
      revenue: posOrderRevenue(o),
    }));
    const lines = [
      { order_id: [1, "Orden Demo 1"] as [number, string], product_id: [501, "Producto Demo"] as [number, string], product_uom_qty: 1, purchase_price: 6_000 },
      { order_id: [2, "Orden Demo 2"] as [number, string], product_id: [502, "Producto Demo"] as [number, string], product_uom_qty: 1, purchase_price: 3_000 },
    ];

    const [row] = await buildSnapshotRows(orders, lines, new Map());

    expect(row.dateKey).toBe("2026-10-15");
    expect(row.totalRevenue).toBe(15_000);
    expect(row.avgTicket).toBe(7_500);
    expect(row.grossProfit).toBe(6_000);
  });
});

describe("backfillSalesHistory", () => {
  it("guarda en FinancialSnapshot la base sin IVA, no amount_total", async () => {
    getPosOrdersBetween.mockResolvedValue([posOrder(1, 11_900, 1_900)]);
    getPosOrderLines.mockResolvedValue([posLine(1, 10_000, 6_000)]);

    const meses = await backfillSalesHistory(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-20T00:00:00Z"));

    expect(meses).toEqual([{ month: "2026-10", orders: 1, days: 1, revenue: 10_000 }]);

    const insert = executeRaw.mock.calls.find(([strings]) =>
      (strings as TemplateStringsArray).join("").includes('INSERT INTO "FinancialSnapshot"')
    );
    expect(insert).toBeDefined();
    // Valores del VALUES en orden: dateKey, totalRevenue, totalCost, grossProfit, ...
    const values = (insert![1] as { values: unknown[] }).values;
    expect(values.slice(0, 4)).toEqual(["2026-10-15", 10_000, 6_000, 4_000]);
  });
});
