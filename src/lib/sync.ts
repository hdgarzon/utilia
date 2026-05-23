import "server-only";
import { prisma } from "@/lib/prisma";
import { odoo } from "@/lib/odoo";
import { startOfDay, subDays } from "date-fns";

async function getLastSync(entity: string): Promise<Date | undefined> {
  const state = await prisma.syncState.findUnique({ where: { entity } });
  return state?.lastSyncAt;
}

async function updateSyncState(entity: string, status: "idle" | "syncing" | "error", error?: string) {
  await prisma.syncState.upsert({
    where: { entity },
    create: { entity, lastSyncAt: new Date(), status, error },
    update: { lastSyncAt: new Date(), status, error },
  });
}

export async function syncProducts() {
  await updateSyncState("product_template", "syncing");
  try {
    const since = await getLastSync("product_template");
    const products = await odoo.getProducts(since);

    for (const p of products) {
      await prisma.productInsight.upsert({
        where: { odooProductId: p.id },
        create: {
          odooProductId: p.id,
          internalRef: p.default_code || null,
          name: p.name,
          category: p.categ_id?.[1] ?? null,
          stockQty: p.qty_available,
          cmp: p.standard_price,
          salePrice: p.list_price,
        },
        update: {
          name: p.name,
          category: p.categ_id?.[1] ?? null,
          stockQty: p.qty_available,
          cmp: p.standard_price,
          salePrice: p.list_price,
        },
      });
    }

    await updateSyncState("product_template", "idle");
    return { synced: products.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSyncState("product_template", "error", msg);
    throw err;
  }
}

export async function syncStock() {
  await updateSyncState("stock_quant", "syncing");
  try {
    const quants = await odoo.getStockQuants();

    const byProduct: Record<number, number> = {};
    for (const q of quants) {
      const pid = q.product_id[0];
      byProduct[pid] = (byProduct[pid] ?? 0) + q.quantity;
    }

    for (const [productId, qty] of Object.entries(byProduct)) {
      await prisma.productInsight.updateMany({
        where: { odooProductId: Number(productId) },
        data: { stockQty: qty },
      });
    }

    await updateSyncState("stock_quant", "idle");
    return { synced: Object.keys(byProduct).length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSyncState("stock_quant", "error", msg);
    throw err;
  }
}

export async function syncSalesAndComputeMetrics() {
  await updateSyncState("sale_order", "syncing");
  try {
    const since = (await getLastSync("sale_order")) ?? subDays(new Date(), 90);
    const orders = await odoo.getSaleOrders(since);

    if (orders.length === 0) {
      await updateSyncState("sale_order", "idle");
      return { synced: 0 };
    }

    const orderIds = orders.map((o) => o.id);
    const lines = await odoo.getSaleOrderLines(orderIds);

    const salesByDate: Record<string, { revenue: number; cost: number; count: number; tickets: number[] }> = {};

    for (const order of orders) {
      const dateKey = order.date_order.slice(0, 10);
      if (!salesByDate[dateKey]) {
        salesByDate[dateKey] = { revenue: 0, cost: 0, count: 0, tickets: [] };
      }
      salesByDate[dateKey].revenue += order.amount_total;
      salesByDate[dateKey].tickets.push(order.amount_total);
      salesByDate[dateKey].count += 1;
    }

    const productSales: Record<number, { qty: number; lastSold: Date }> = {};
    for (const line of lines) {
      const pid = line.product_id[0];
      const order = orders.find((o) => o.id === line.order_id[0]);
      const saleDate = order ? new Date(order.date_order) : new Date();
      if (!productSales[pid] || saleDate > productSales[pid].lastSold) {
        productSales[pid] = { qty: (productSales[pid]?.qty ?? 0) + line.product_uom_qty, lastSold: saleDate };
      } else {
        productSales[pid].qty += line.product_uom_qty;
      }
    }

    for (const [dateKey, data] of Object.entries(salesByDate)) {
      const date = startOfDay(new Date(dateKey));
      const avgTicket = data.tickets.reduce((a, b) => a + b, 0) / data.tickets.length;
      const netProfit = data.revenue - data.cost;
      const netMarginPct = data.revenue > 0 ? (netProfit / data.revenue) * 100 : 0;

      await prisma.financialSnapshot.upsert({
        where: { date },
        create: {
          date,
          totalRevenue: data.revenue,
          totalCost: data.cost,
          grossProfit: data.revenue - data.cost,
          netProfit,
          netMarginPct,
          transactionCount: data.count,
          avgTicket,
        },
        update: {
          totalRevenue: data.revenue,
          totalCost: data.cost,
          grossProfit: data.revenue - data.cost,
          netProfit,
          netMarginPct,
          transactionCount: data.count,
          avgTicket,
        },
      });
    }

    const now = new Date();
    const last7 = subDays(now, 7);
    const last14 = subDays(now, 14);
    const last30 = subDays(now, 30);

    for (const [pid, data] of Object.entries(productSales)) {
      const productId = Number(pid);
      const daysSinceSale = Math.floor((now.getTime() - data.lastSold.getTime()) / (1000 * 60 * 60 * 24));
      const dailyRate7d = data.qty / 7;
      const dailyRate14d = data.qty / 14;
      const dailyRate30d = data.qty / 30;

      await prisma.productInsight.updateMany({
        where: { odooProductId: productId },
        data: {
          avgDailySales7d: dailyRate7d,
          avgDailySales14d: dailyRate14d,
          avgDailySales30d: dailyRate30d,
          lastSoldAt: data.lastSold,
          rotationDays: daysSinceSale,
        },
      });
    }

    await prisma.productInsight.updateMany({
      where: { avgDailySales7d: { gt: 0 } },
      data: {},
    });

    const products = await prisma.productInsight.findMany({ where: { avgDailySales7d: { gt: 0 } } });
    for (const p of products) {
      if (p.avgDailySales7d > 0) {
        const daysOfStock = p.stockQty / p.avgDailySales7d;
        await prisma.productInsight.update({
          where: { id: p.id },
          data: { daysOfStock },
        });
      }
    }

    await updateSyncState("sale_order", "idle");
    return { synced: orders.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSyncState("sale_order", "error", msg);
    throw err;
  }
}

export async function runFullSync() {
  const results = await Promise.allSettled([
    syncProducts(),
    syncStock(),
    syncSalesAndComputeMetrics(),
  ]);
  return results;
}
