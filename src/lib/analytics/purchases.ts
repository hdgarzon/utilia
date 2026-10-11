import { prisma } from "@/lib/prisma";
import { colombiaDaysAgo, colombiaYearMonthDay } from "@/lib/timezone";
import { NO_REORDER_DAYS } from "@/lib/analytics/dead-stock";

export interface MonthlyPurchaseSummary {
  year: number;
  month: number; // 1-12
  ordersCount: number; // entradas/órdenes confirmadas en el mes
  unitsReceived: number;
  distinctProducts: number;
  totalSpent: number; // amountTotal (con IVA) — salida de caja real
  totalUntaxed: number; // amountUntaxed — comparable contra COGS/fondo de reposición
  prevMonthSpent: number;
  deltaPct: number | null; // null si el mes anterior no tuvo compras (evita división por cero)
  topProducts: Array<{ odooProductId: number; name: string; qty: number; value: number }>;
  recentOrders: Array<{ name: string; partnerName: string | null; dateOrder: Date; amountTotal: number }>;
}

/** Rango [inicio, fin) de un mes calendario en Colombia, expresado en UTC. */
function monthRangeCO(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/**
 * Resumen de compras reales a proveedor (entradas de mercancía) para un mes.
 * Por defecto el mes actual en Colombia. Lee de la tabla local `PurchaseOrder`
 * (sincronizada desde Odoo), no golpea Odoo en vivo — rápido para render de página.
 */
export async function getMonthlyPurchaseSummary(
  year?: number,
  month?: number
): Promise<MonthlyPurchaseSummary> {
  const now = colombiaYearMonthDay();
  const y = year ?? now.year;
  const m = month ?? now.month;
  const { start, end } = monthRangeCO(y, m);
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const { start: prevStart, end: prevEnd } = monthRangeCO(prevY, prevM);

  const [orders, prevAgg, lineAgg, distinctLines, recentOrders] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { dateOrder: { gte: start, lt: end } },
      select: { amountTotal: true, amountUntaxed: true },
    }),
    prisma.purchaseOrder.aggregate({
      where: { dateOrder: { gte: prevStart, lt: prevEnd } },
      _sum: { amountTotal: true },
    }),
    prisma.purchaseOrderLine.groupBy({
      by: ["odooProductId", "productName"],
      where: { purchaseOrder: { dateOrder: { gte: start, lt: end } } },
      _sum: { qty: true, priceSubtotal: true },
      orderBy: { _sum: { priceSubtotal: "desc" } },
      take: 10,
    }),
    prisma.purchaseOrderLine.findMany({
      where: { purchaseOrder: { dateOrder: { gte: start, lt: end } } },
      distinct: ["odooProductId"],
      select: { odooProductId: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { dateOrder: { gte: start, lt: end } },
      orderBy: { dateOrder: "desc" },
      take: 10,
      select: { name: true, partnerName: true, dateOrder: true, amountTotal: true },
    }),
  ]);

  const totalSpent = orders.reduce((s, o) => s + o.amountTotal, 0);
  const totalUntaxed = orders.reduce((s, o) => s + o.amountUntaxed, 0);
  const prevMonthSpent = prevAgg._sum.amountTotal ?? 0;
  const deltaPct = prevMonthSpent > 0 ? ((totalSpent - prevMonthSpent) / prevMonthSpent) * 100 : null;

  const unitsAgg = await prisma.purchaseOrderLine.aggregate({
    where: { purchaseOrder: { dateOrder: { gte: start, lt: end } } },
    _sum: { qty: true },
  });

  return {
    year: y,
    month: m,
    ordersCount: orders.length,
    unitsReceived: unitsAgg._sum.qty ?? 0,
    distinctProducts: distinctLines.length,
    totalSpent,
    totalUntaxed,
    prevMonthSpent,
    deltaPct,
    topProducts: lineAgg.map((l) => ({
      odooProductId: l.odooProductId,
      name: l.productName,
      qty: l._sum.qty ?? 0,
      value: l._sum.priceSubtotal ?? 0,
    })),
    recentOrders: recentOrders.map((o) => ({
      name: o.name,
      partnerName: o.partnerName,
      dateOrder: o.dateOrder,
      amountTotal: o.amountTotal,
    })),
  };
}

export interface FrozenPurchases {
  windowDays: number;
  total: number; // valor sin IVA comprado a referencias congeladas
  products: Array<{ odooProductId: number; name: string; qty: number; value: number; rotationDays: number }>;
}

/**
 * Compras recientes a referencias que la regla de no-recompra congela (mas de
 * NO_REORDER_DAYS dias sin venta). El sistema ya no las sugiere, pero en Odoo
 * se pueden seguir comprando a mano: esto mide esa fuga de caja hacia
 * mercancia que no rota.
 */
export async function getFrozenPurchases(windowDays = 30): Promise<FrozenPurchases> {
  const since = colombiaDaysAgo(windowDays).toISOString();
  const rows = await prisma.$queryRaw<
    Array<{ odooProductId: number; name: string; qty: number; value: number; rotationDays: number }>
  >`
    SELECT l."odooProductId", MIN(l."productName") AS name,
           SUM(l.qty)::float8 AS qty, SUM(l."priceSubtotal")::float8 AS value,
           MIN(p."rotationDays")::int AS "rotationDays"
    FROM "PurchaseOrderLine" l
    JOIN "PurchaseOrder" o ON o.id = l."purchaseOrderId"
    JOIN "ProductInsight" p ON p."odooProductId" = l."odooProductId"
    WHERE o."dateOrder" >= ${since}::timestamptz
      AND p."rotationDays" > ${NO_REORDER_DAYS}
    GROUP BY l."odooProductId"
    ORDER BY value DESC
  `;
  return {
    windowDays,
    total: rows.reduce((s, r) => s + r.value, 0),
    products: rows,
  };
}
