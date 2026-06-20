import { prisma } from "@/lib/prisma";
import { odoo } from "@/lib/odoo";
import { startOfDay, subDays } from "date-fns";

// Sentinel: la primera vez no existe el registro, devolvemos undefined
async function getLastSync(entity: string): Promise<Date | undefined> {
  const state = await prisma.syncState.findUnique({ where: { entity } });
  return state?.lastSyncAt;
}

// Marca el estado SIN tocar lastSyncAt (preserva el punto de corte del próximo since)
async function markSyncStatus(entity: string, status: "syncing" | "error", error?: string) {
  await prisma.syncState.upsert({
    where: { entity },
    // Si es la primera vez creamos lastSyncAt en el epoch para que getLastSync devuelva ~"sin sync previo"
    create: { entity, lastSyncAt: new Date(0), status, error },
    update: { status, error },
  });
}

// Solo al terminar exitosamente bumpeamos lastSyncAt
async function recordSyncSuccess(entity: string, syncedAt: Date = new Date()) {
  await prisma.syncState.upsert({
    where: { entity },
    create: { entity, lastSyncAt: syncedAt, status: "idle", error: null },
    update: { lastSyncAt: syncedAt, status: "idle", error: null },
  });
}

export async function syncProducts() {
  const runStart = new Date();
  // Leer el cutoff ANTES de marcar "syncing" para no machacarlo
  const since = await getLastSync("product_template");
  await markSyncStatus("product_template", "syncing");

  try {
    const products = await odoo.getProducts(since);

    // Si Odoo no devuelve nada (porque since está al día), no es error — registrar y salir
    if (products.length === 0) {
      await recordSyncSuccess("product_template", runStart);
      return { synced: 0 };
    }

    // Upserts en lotes de 100 dentro de UNA transacción por lote = 1 round-trip
    // por cada 100 productos. Antes: CHUNK=5 secuencial → ~320 round-trips para
    // 1600 productos, lo que excedía el límite de la función serverless ANTES de
    // llegar a recordSyncSuccess → lastSyncAt quedaba en epoch y cada sync
    // reintentaba el catálogo completo (loop infinito de timeouts).
    const CHUNK = 100;
    for (let i = 0; i < products.length; i += CHUNK) {
      await prisma.$transaction(
        products.slice(i, i + CHUNK).map((p) =>
          prisma.productInsight.upsert({
            where: { odooProductId: p.id },
            create: {
              odooProductId: p.id,
              odooTemplateId: p.product_tmpl_id?.[0] ?? null,
              templateName: p.product_tmpl_id?.[1] ?? null,
              internalRef: p.default_code || null,
              name: p.name,
              category: p.categ_id?.[1] ?? null,
              stockQty: p.qty_available,
              cmp: p.standard_price,
              salePrice: p.list_price,
            },
            update: {
              odooTemplateId: p.product_tmpl_id?.[0] ?? null,
              templateName: p.product_tmpl_id?.[1] ?? null,
              name: p.name,
              category: p.categ_id?.[1] ?? null,
              stockQty: p.qty_available,
              cmp: p.standard_price,
              salePrice: p.list_price,
            },
          })
        )
      );
    }

    await recordSyncSuccess("product_template", runStart);
    return { synced: products.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markSyncStatus("product_template", "error", msg);
    throw err;
  }
}

export async function syncStock() {
  const runStart = new Date();
  await markSyncStatus("stock_quant", "syncing");
  try {
    const quants = await odoo.getStockQuants();

    // Suma cantidades por producto (un producto puede estar en varios almacenes)
    const byProduct = new Map<number, number>();
    for (const q of quants) {
      const pid = q.product_id[0];
      byProduct.set(pid, (byProduct.get(pid) ?? 0) + q.quantity);
    }

    // Bulk update en una sola query SQL por lote de 1000 productos.
    // Antes: 327 round-trips con CHUNK=5 → timeout en funciones serverless.
    // Ahora: 2 round-trips máximo para 1634 productos.
    const entries = Array.from(byProduct.entries());
    const SQL_CHUNK = 1000;
    for (let i = 0; i < entries.length; i += SQL_CHUNK) {
      const slice = entries.slice(i, i + SQL_CHUNK);
      // Construye: UPDATE "ProductInsight" SET "stockQty" = v.qty
      //            FROM (VALUES (id,qty),...) AS v("odooProductId", qty)
      //            WHERE "ProductInsight"."odooProductId" = v."odooProductId"
      const values = slice.map(([id, qty]) => `(${id}, ${qty})`).join(",");
      await prisma.$executeRawUnsafe(`
        UPDATE "ProductInsight" p
        SET "stockQty" = v.qty
        FROM (VALUES ${values}) AS v("odooProductId", qty)
        WHERE p."odooProductId" = v."odooProductId"
      `);
    }

    await recordSyncSuccess("stock_quant", runStart);
    return { synced: byProduct.size };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markSyncStatus("stock_quant", "error", msg);
    throw err;
  }
}

export async function syncSalesAndComputeMetrics() {
  const runStart = new Date();
  // Para POS, los datos viven en pos.order (no sale.order). Usamos ese modelo.
  const sinceFromState = await getLastSync("pos_order");

  // Colombia = UTC-5 sin DST. Calculamos "inicio del día de hoy en Colombia"
  // expresado en UTC, para que el sync siempre re-traiga TODAS las órdenes del
  // día actual aunque ya haya corrido antes. Sin esto, un sync incremental a
  // las 7pm sobreescribiría el snapshot del día con solo las órdenes nuevas.
  const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000;
  const nowCO = new Date(Date.now() - COLOMBIA_OFFSET_MS);
  const startOfTodayCO = new Date(
    Date.UTC(nowCO.getUTCFullYear(), nowCO.getUTCMonth(), nowCO.getUTCDate()) + COLOMBIA_OFFSET_MS
  );

  // Usar el más temprano entre lastSyncAt y inicio-de-hoy Colombia, con
  // fallback a 90 días para el sync inicial.
  const since =
    sinceFromState && sinceFromState.getTime() > 0
      ? new Date(Math.min(sinceFromState.getTime(), startOfTodayCO.getTime()))
      : subDays(new Date(), 90);

  await markSyncStatus("pos_order", "syncing");

  try {
    const posOrders = await odoo.getPosOrders(since);
    // Adaptador a la estructura genérica usada por el resto del cálculo
    const orders = posOrders.map((o) => ({
      id: o.id,
      date_order: o.date_order,
      amount_total: o.amount_total,
    }));

    if (orders.length === 0) {
      await recordSyncSuccess("pos_order", runStart);
      await recomputeDaysOfStock();
      return { synced: 0 };
    }

    const orderIds = orders.map((o) => o.id);
    const posLines = await odoo.getPosOrderLines(orderIds);
    // Adaptador: mapeamos campos POS al shape usado por el resto del flujo
    const lines = posLines.map((l) => ({
      order_id: l.order_id,
      product_id: l.product_id,
      product_uom_qty: l.qty,
      // total_cost ya viene multiplicado (qty * unit_cost) — convertimos a unit_cost
      // para que la lógica downstream (que multiplica por qty) dé el costo total correcto.
      purchase_price: l.qty > 0 ? l.total_cost / l.qty : 0,
    }));

    // ── 0. Cargar tabla de costos actuales (fallback para órdenes sin purchase_price)
    const referencedIdsForCosts = Array.from(new Set(lines.map((l) => l.product_id[0])));
    const productCosts = await prisma.productInsight.findMany({
      where: { odooProductId: { in: referencedIdsForCosts } },
      select: { odooProductId: true, cmp: true },
    });
    const cmpByProduct = new Map(productCosts.map((p) => [p.odooProductId, p.cmp]));

    // ── 1. Agregar ventas + costos por día ─────────────────────────────────
    // Odoo guarda date_order en UTC. Convertimos a fecha local Colombia (UTC-5)
    // para que órdenes del 25 de mayo a las 8pm Colombia (= 1am UTC 26 mayo)
    // queden en el snapshot del 25, no del 26.
    const toColombiaDateKey = (dateOrderUtc: string): string => {
      const dt = new Date(dateOrderUtc + "Z");
      const localMs = dt.getTime() - COLOMBIA_OFFSET_MS;
      return new Date(localMs).toISOString().slice(0, 10);
    };

    const orderDateKey = new Map(orders.map((o) => [o.id, toColombiaDateKey(o.date_order)]));
    const salesByDate = new Map<string, { revenue: number; cost: number; count: number; tickets: number[] }>();

    for (const order of orders) {
      const dateKey = toColombiaDateKey(order.date_order);
      const bucket = salesByDate.get(dateKey) ?? { revenue: 0, cost: 0, count: 0, tickets: [] };
      bucket.revenue += order.amount_total;
      bucket.tickets.push(order.amount_total);
      bucket.count += 1;
      salesByDate.set(dateKey, bucket);
    }

    // Sumar costos por día a partir de las líneas
    for (const line of lines) {
      const dateKey = orderDateKey.get(line.order_id[0]);
      if (!dateKey) continue;
      const bucket = salesByDate.get(dateKey);
      if (!bucket) continue;
      // Prioridad: purchase_price histórico > CMP actual del producto > 0
      const unitCost =
        typeof line.purchase_price === "number" && line.purchase_price > 0
          ? line.purchase_price
          : cmpByProduct.get(line.product_id[0]) ?? 0;
      bucket.cost += unitCost * line.product_uom_qty;
    }

    // ── 2. Agregar ventas por producto ─────────────────────────────────────
    // O(1) lookup de fecha de orden con un Map
    const orderDate = new Map(orders.map((o) => [o.id, new Date(o.date_order)]));
    const productSales = new Map<number, { qty: number; lastSold: Date }>();
    for (const line of lines) {
      const pid = line.product_id[0];
      const saleDate = orderDate.get(line.order_id[0]) ?? new Date();
      const existing = productSales.get(pid);
      if (!existing) {
        productSales.set(pid, { qty: line.product_uom_qty, lastSold: saleDate });
      } else {
        existing.qty += line.product_uom_qty;
        if (saleDate > existing.lastSold) existing.lastSold = saleDate;
      }
    }

    // ── 3. Upsert snapshots financieros diarios con utilidad real ─────────
    // Precarga presupuesto de gastos fijos por mes para prorratear (memoizado)
    const fixedExpensesPerDay = new Map<string, number>();
    async function getFixedExpensesForDay(date: Date): Promise<number> {
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      const cached = fixedExpensesPerDay.get(key);
      if (cached !== undefined) return cached;
      const budgets = await prisma.expenseBudget.findMany({
        where: { year: date.getFullYear(), month: date.getMonth() + 1 },
      });
      const totalMonthly = budgets.reduce((sum, b) => sum + b.budgetAmount, 0);
      // días en el mes para distribuir uniformemente
      const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      const perDay = totalMonthly / daysInMonth;
      fixedExpensesPerDay.set(key, perDay);
      return perDay;
    }

    // Construir todos los upserts resolviendo gastos fijos ANTES de la tx
    // (getFixedExpensesForDay está memoizado: máx ~4 consultas para 90 días).
    const snapshotOps = [];
    for (const [dateKey, data] of salesByDate) {
      const date = startOfDay(new Date(dateKey));
      const avgTicket = data.tickets.reduce((a, b) => a + b, 0) / data.tickets.length;
      const grossProfit = data.revenue - data.cost;
      const fixedExpenses = await getFixedExpensesForDay(date);
      const netProfit = grossProfit - fixedExpenses;
      const netMarginPct = data.revenue > 0 ? (netProfit / data.revenue) * 100 : 0;
      const payload = {
        totalRevenue: data.revenue,
        totalCost: data.cost,
        grossProfit,
        fixedExpenses,
        netProfit,
        netMarginPct,
        transactionCount: data.count,
        avgTicket,
      };
      snapshotOps.push(
        prisma.financialSnapshot.upsert({
          where: { date },
          create: { date, ...payload },
          update: payload,
        })
      );
    }
    // Ejecutar en lotes: 1 round-trip por cada 100 días (antes: 1 por día)
    for (let i = 0; i < snapshotOps.length; i += 100) {
      await prisma.$transaction(snapshotOps.slice(i, i + 100));
    }

    // ── 3.5. Crear stubs para productos que referencian las líneas pero no
    // están en nuestra BD (ej: productos archivados en Odoo). Sin stubs, el
    // updateMany no hace nada y se pierden las métricas.
    const referencedIds = Array.from(productSales.keys());
    const existing = await prisma.productInsight.findMany({
      where: { odooProductId: { in: referencedIds } },
      select: { odooProductId: true },
    });
    const existingIds = new Set(existing.map((e) => e.odooProductId));
    const missingIds = referencedIds.filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      const stubs = await odoo.getProductsByIds(missingIds);
      const stubOps = stubs.map((p) => {
        const label = p.active ? p.name : `${p.name} (archivado)`;
        return prisma.productInsight.upsert({
          where: { odooProductId: p.id },
          create: {
            odooProductId: p.id,
            odooTemplateId: p.product_tmpl_id?.[0] ?? null,
            templateName: p.product_tmpl_id?.[1] ?? null,
            internalRef: p.default_code || null,
            name: label,
            category: p.categ_id?.[1] ?? null,
            stockQty: p.qty_available,
            cmp: p.standard_price,
            salePrice: p.list_price,
          },
          update: { name: label, odooTemplateId: p.product_tmpl_id?.[0] ?? null, templateName: p.product_tmpl_id?.[1] ?? null },
        });
      });
      for (let i = 0; i < stubOps.length; i += 100) {
        await prisma.$transaction(stubOps.slice(i, i + 100));
      }
    }

    // ── 4. Actualizar ventas promedio + rotación por producto ─────────────
    const now = new Date();
    const productOps = Array.from(productSales.entries()).map(([pid, data]) => {
      const daysSinceSale = Math.floor((now.getTime() - data.lastSold.getTime()) / 86_400_000);
      return prisma.productInsight.updateMany({
        where: { odooProductId: pid },
        data: {
          avgDailySales7d: data.qty / 7,
          avgDailySales14d: data.qty / 14,
          avgDailySales30d: data.qty / 30,
          lastSoldAt: data.lastSold,
          rotationDays: daysSinceSale,
        },
      });
    });
    // 1 round-trip por cada 100 productos (antes: CHUNK=5 → cientos de round-trips)
    for (let i = 0; i < productOps.length; i += 100) {
      await prisma.$transaction(productOps.slice(i, i + 100));
    }

    // ── 5. Recalcular días de stock para todos los productos con ventas ───
    await recomputeDaysOfStock();

    await recordSyncSuccess("pos_order", runStart);
    return { synced: orders.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markSyncStatus("pos_order", "error", msg);
    throw err;
  }
}

// Helper: calcula daysOfStock = stockQty / avgDailySales7d (con cap razonable)
async function recomputeDaysOfStock() {
  // Usamos SQL crudo para hacerlo en un solo round-trip y no traer 1500+ rows a Node
  await prisma.$executeRaw`
    UPDATE "ProductInsight"
    SET "daysOfStock" = CASE
      WHEN "avgDailySales7d" > 0 THEN LEAST("stockQty" / "avgDailySales7d", 999)
      ELSE 0
    END
  `;
}

export async function runFullSync() {
  // Secuencial (no Promise.allSettled) a propósito: los 3 jobs comparten el
  // mismo pooler de Supabase (pgbouncer). En paralelo competían por conexiones
  // y, sumado a los round-trips por fila, agotaban el presupuesto de la función
  // (504/timeout). Con escrituras en lote cada job termina en segundos, así que
  // en serie el total sigue siendo bajo y sin contención. Cada job maneja su
  // propio estado, por eso un fallo no aborta los siguientes.
  const jobs = [syncProducts, syncStock, syncSalesAndComputeMetrics];
  const results: PromiseSettledResult<{ synced: number }>[] = [];
  for (const job of jobs) {
    try {
      results.push({ status: "fulfilled", value: await job() });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
  }
  return results;
}
