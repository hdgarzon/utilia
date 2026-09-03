import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { odoo } from "@/lib/odoo";
import { colombiaStartOfPreviousMonth } from "@/lib/timezone";
import { recomputeStockLevels } from "@/lib/analytics/stock-levels";

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

// ─── Escritura en lote (SQL crudo de UNA sola sentencia por lote) ────────────
// Lección aprendida: prisma.$transaction([...]) hace un round-trip POR sentencia
// (sin pipeline), así que para miles de filas (productos con variantes ~5000) un
// solo job tardaba ~4 min y agotaba el presupuesto de la función serverless ANTES
// de que el siguiente job (ventas) pudiera terminar. Estas funciones colapsan
// cada lote en UNA sentencia (como ya hacía syncStock), pasando de miles de
// round-trips a unos pocos. Los strings van parametrizados con Prisma.sql para
// evitar inyección con nombres de producto que tengan comillas.

type ProductRow = {
  id: number;
  templateId: number | null;
  templateName: string | null;
  internalRef: string | null;
  name: string;
  category: string | null;
  stockQty: number;
  cmp: number;
  salePrice: number;
};

// id y updatedAt no tienen default en la BD (Prisma los genera en el cliente);
// por eso los seteamos explícitos: gen_random_uuid()::text (PG15) y now().
async function bulkUpsertProducts(rows: ProductRow[]) {
  if (rows.length === 0) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows.slice(i, i + CHUNK).map(
      (r) => Prisma.sql`(gen_random_uuid()::text, ${r.id}, ${r.templateId}, ${r.templateName}, ${r.internalRef}, ${r.name}, ${r.category}, ${r.stockQty}, ${r.cmp}, ${r.salePrice}, now())`
    );
    await prisma.$executeRaw`
      INSERT INTO "ProductInsight" (
        "id", "odooProductId", "odooTemplateId", "templateName", "internalRef",
        "name", "category", "stockQty", "cmp", "salePrice", "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("odooProductId") DO UPDATE SET
        "odooTemplateId" = EXCLUDED."odooTemplateId",
        "templateName"   = EXCLUDED."templateName",
        "name"           = EXCLUDED."name",
        "category"       = EXCLUDED."category",
        "stockQty"       = EXCLUDED."stockQty",
        "cmp"            = EXCLUDED."cmp",
        "salePrice"      = EXCLUDED."salePrice",
        "updatedAt"      = now()
    `;
  }
}

type SnapshotRow = {
  dateKey: string; // "YYYY-MM-DD" — se castea a ::date para evitar ambigüedad de zona
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  fixedExpenses: number;
  netProfit: number;
  netMarginPct: number;
  transactionCount: number;
  avgTicket: number;
};

async function bulkUpsertSnapshots(rows: SnapshotRow[]) {
  if (rows.length === 0) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows.slice(i, i + CHUNK).map(
      (r) => Prisma.sql`(gen_random_uuid()::text, ${r.dateKey}::date, ${r.totalRevenue}, ${r.totalCost}, ${r.grossProfit}, ${r.fixedExpenses}, ${r.netProfit}, ${r.netMarginPct}, ${r.transactionCount}, ${r.avgTicket}, now())`
    );
    await prisma.$executeRaw`
      INSERT INTO "FinancialSnapshot" (
        "id", "date", "totalRevenue", "totalCost", "grossProfit",
        "fixedExpenses", "netProfit", "netMarginPct", "transactionCount", "avgTicket", "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("date") DO UPDATE SET
        "totalRevenue"     = EXCLUDED."totalRevenue",
        "totalCost"        = EXCLUDED."totalCost",
        "grossProfit"      = EXCLUDED."grossProfit",
        "fixedExpenses"    = EXCLUDED."fixedExpenses",
        "netProfit"        = EXCLUDED."netProfit",
        "netMarginPct"     = EXCLUDED."netMarginPct",
        "transactionCount" = EXCLUDED."transactionCount",
        "avgTicket"        = EXCLUDED."avgTicket",
        "updatedAt"        = now()
    `;
  }
}

type ProductSalesRow = {
  pid: number;
  v7: number;
  v14: number;
  v30: number;
  lastSoldIso: string; // ISO-8601 con Z — cast a ::timestamptz, inequívoco
  rotationDays: number;
};

async function bulkUpdateProductSales(rows: ProductSalesRow[]) {
  if (rows.length === 0) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    // Casts explícitos por fila: en `FROM (VALUES ...)` Postgres no infiere el
    // tipo de los parámetros, así que hay que decírselo.
    const values = rows.slice(i, i + CHUNK).map(
      (r) => Prisma.sql`(${r.pid}::int, ${r.v7}::float8, ${r.v14}::float8, ${r.v30}::float8, ${r.lastSoldIso}::timestamptz, ${r.rotationDays}::int)`
    );
    await prisma.$executeRaw`
      UPDATE "ProductInsight" p SET
        "avgDailySales7d"  = v.v7,
        "avgDailySales14d" = v.v14,
        "avgDailySales30d" = v.v30,
        "lastSoldAt"       = v.last_sold,
        "rotationDays"     = v.rotation_days
      FROM (VALUES ${Prisma.join(values)}) AS v("odooProductId", v7, v14, v30, last_sold, rotation_days)
      WHERE p."odooProductId" = v."odooProductId"
    `;
  }
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

    await bulkUpsertProducts(
      products.map((p) => ({
        id: p.id,
        templateId: p.product_tmpl_id?.[0] ?? null,
        templateName: p.product_tmpl_id?.[1] ?? null,
        internalRef: p.default_code || null,
        // display_name distingue cada variante (atributos incluidos); el nombre
        // de la familia queda en templateName para las vistas consolidadas.
        name: p.display_name || p.name,
        category: p.categ_id?.[1] ?? null,
        stockQty: p.qty_available,
        cmp: p.standard_price,
        salePrice: p.list_price,
      }))
    );

    await recordSyncSuccess("product_template", runStart);
    return { synced: products.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markSyncStatus("product_template", "error", msg);
    throw err;
  }
}

// Cabecera + líneas de purchase.order. Volumen bajo (decenas al mes), por eso
// usa upserts/deletes por-orden en vez de las escrituras SQL en lote de arriba
// — no hay presión de tiempo serverless como con productos/ventas.
async function upsertPurchaseOrder(
  order: {
    odooOrderId: number;
    name: string;
    partnerName: string | null;
    odooPartnerId: number | null;
    dateOrder: Date;
    amountUntaxed: number;
    amountTotal: number;
    state: string;
  },
  lines: Array<{ odooProductId: number; productName: string; qty: number; priceSubtotal: number }>
) {
  const saved = await prisma.purchaseOrder.upsert({
    where: { odooOrderId: order.odooOrderId },
    create: order,
    update: order,
  });
  // Reemplazar líneas: más simple y seguro que diffear (una orden de compra
  // rara vez cambia de líneas una vez confirmada, y el volumen es bajo).
  await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: saved.id } });
  if (lines.length > 0) {
    await prisma.purchaseOrderLine.createMany({
      data: lines.map((l) => ({ ...l, purchaseOrderId: saved.id })),
    });
  }
}

export async function syncPurchases() {
  const runStart = new Date();
  const since = await getLastSync("purchase_order");
  await markSyncStatus("purchase_order", "syncing");

  try {
    const orders = await odoo.getPurchaseOrders(since);

    if (orders.length === 0) {
      await recordSyncSuccess("purchase_order", runStart);
      return { synced: 0 };
    }

    const lines = await odoo.getPurchaseOrderLines(orders.map((o) => o.id));
    const linesByOrder = new Map<number, typeof lines>();
    for (const l of lines) {
      const arr = linesByOrder.get(l.order_id[0]) ?? [];
      arr.push(l);
      linesByOrder.set(l.order_id[0], arr);
    }

    for (const o of orders) {
      // date_approve puede venir `false` en órdenes "done" sin fecha de
      // aprobación registrada; usamos "ahora" como fallback razonable.
      const dateOrder = o.date_approve ? new Date(o.date_approve + "Z") : runStart;
      const orderLines = linesByOrder.get(o.id) ?? [];
      await upsertPurchaseOrder(
        {
          odooOrderId: o.id,
          name: o.name,
          partnerName: o.partner_id ? o.partner_id[1] : null,
          odooPartnerId: o.partner_id ? o.partner_id[0] : null,
          dateOrder,
          amountUntaxed: o.amount_untaxed,
          amountTotal: o.amount_total,
          state: o.state,
        },
        orderLines
          // Líneas de sección/nota (display_type) no tienen producto: product_id
          // viene `false`. No representan una entrada de mercancía, se descartan.
          .filter((l): l is typeof l & { product_id: [number, string] } => Array.isArray(l.product_id))
          .map((l) => ({
            odooProductId: l.product_id[0],
            productName: l.product_id[1],
            qty: l.product_qty,
            priceSubtotal: l.price_subtotal,
          }))
      );
    }

    // Cierre de ciclo de reabastecimiento: si una orden creada desde Utilia ya
    // aparece confirmada en Odoo (state purchase/done → entró al sync), el
    // pedido pasa a RECIBIDO. Falla suave: un error aquí no tumba el sync.
    try {
      await prisma.$executeRaw`
        UPDATE "ReplenishmentOrder" r
        SET status = 'RECEIVED', "receivedAt" = p."dateOrder", "updatedAt" = now()
        FROM "PurchaseOrder" p
        WHERE p."odooOrderId" = r."odooOrderId"
          AND r.status IN ('APPROVED', 'SENT')
      `;
    } catch (err) {
      console.warn("[sync] cierre de reabastecimiento fallo:", err);
    }

    await recordSyncSuccess("purchase_order", runStart);
    return { synced: orders.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markSyncStatus("purchase_order", "error", msg);
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
    // Sólo números (no strings), por eso es seguro construir el VALUES inline.
    const entries = Array.from(byProduct.entries());
    const SQL_CHUNK = 1000;
    for (let i = 0; i < entries.length; i += SQL_CHUNK) {
      const slice = entries.slice(i, i + SQL_CHUNK);
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

  // Usar el más temprano entre lastSyncAt y inicio-de-hoy Colombia. Para el sync
  // inicial (lastSyncAt = epoch) hacemos backfill desde el inicio del mes
  // anterior: cubre el reporte MTD y el comparativo mensual sin traer 90 días de
  // órdenes (que no cabían en el límite de la función → timeout infinito).
  const since =
    sinceFromState && sinceFromState.getTime() > 0
      ? new Date(Math.min(sinceFromState.getTime(), startOfTodayCO.getTime()))
      : colombiaStartOfPreviousMonth();

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
      await recomputeVelocities();
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
    // Gasto fijo prorrateado por mes (memoizado: máx ~2 meses en el backfill).
    const fixedPerDayByMonth = new Map<string, number>();
    async function getFixedPerDay(year: number, month: number): Promise<number> {
      const key = `${year}-${month}`;
      const cached = fixedPerDayByMonth.get(key);
      if (cached !== undefined) return cached;
      const budgets = await prisma.expenseBudget.findMany({ where: { year, month } });
      const totalMonthly = budgets.reduce((sum, b) => sum + b.budgetAmount, 0);
      const daysInMonth = new Date(year, month, 0).getDate();
      const perDay = totalMonthly / daysInMonth;
      fixedPerDayByMonth.set(key, perDay);
      return perDay;
    }

    const snapshotRows: SnapshotRow[] = [];
    for (const [dateKey, data] of salesByDate) {
      const [year, month] = dateKey.split("-").map(Number);
      const avgTicket = data.tickets.reduce((a, b) => a + b, 0) / data.tickets.length;
      const grossProfit = data.revenue - data.cost;
      const fixedExpenses = await getFixedPerDay(year, month);
      const netProfit = grossProfit - fixedExpenses;
      const netMarginPct = data.revenue > 0 ? (netProfit / data.revenue) * 100 : 0;
      snapshotRows.push({
        dateKey,
        totalRevenue: data.revenue,
        totalCost: data.cost,
        grossProfit,
        fixedExpenses,
        netProfit,
        netMarginPct,
        transactionCount: data.count,
        avgTicket,
      });
    }
    await bulkUpsertSnapshots(snapshotRows);

    // ── 3.5. Crear stubs para productos que referencian las líneas pero no
    // están en nuestra BD (ej: productos archivados en Odoo). Sin stubs, el
    // update no encuentra la fila y se pierden las métricas.
    const referencedIds = Array.from(productSales.keys());
    const existing = await prisma.productInsight.findMany({
      where: { odooProductId: { in: referencedIds } },
      select: { odooProductId: true },
    });
    const existingIds = new Set(existing.map((e) => e.odooProductId));
    const missingIds = referencedIds.filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      const stubs = await odoo.getProductsByIds(missingIds);
      await bulkUpsertProducts(
        stubs.map((p) => {
          const label = p.display_name || p.name;
          return {
            id: p.id,
            templateId: p.product_tmpl_id?.[0] ?? null,
            templateName: p.product_tmpl_id?.[1] ?? null,
            internalRef: p.default_code || null,
            name: p.active ? label : `${label} (archivado)`,
            category: p.categ_id?.[1] ?? null,
            stockQty: p.qty_available,
            cmp: p.standard_price,
            salePrice: p.list_price,
          };
        })
      );
    }

    // ── 4. Actualizar ventas promedio + rotación por producto ─────────────
    const now = new Date();
    await bulkUpdateProductSales(
      Array.from(productSales.entries()).map(([pid, data]) => ({
        pid,
        v7: data.qty / 7,
        v14: data.qty / 14,
        v30: data.qty / 30,
        lastSoldIso: data.lastSold.toISOString(),
        rotationDays: Math.floor((now.getTime() - data.lastSold.getTime()) / 86_400_000),
      }))
    );

    // ── 5. Velocidad de venta real (ventana fija 7/14/30 días) + días de stock.
    // OJO: la sección 4 calcula velocidad sobre la ventana incremental (mal: el
    // backfill divide ~50 días entre 7). recomputeVelocities la sobreescribe con
    // el cálculo correcto sobre ventanas fijas. (La sección 4 quedará para limpiar.)
    await recomputeVelocities();

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

async function bulkUpdateDemandStdDev(rows: Array<{ pid: number; sd: number }>) {
  if (rows.length === 0) return;
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows.slice(i, i + CHUNK).map((r) => `(${r.pid}, ${r.sd})`).join(",");
    await prisma.$executeRawUnsafe(`
      UPDATE "ProductInsight" p SET "demandStdDev" = v.sd
      FROM (VALUES ${values}) AS v("odooProductId", sd)
      WHERE p."odooProductId" = v."odooProductId"
    `);
  }
}

/**
 * Recalcula la velocidad de venta REAL por producto sobre ventanas fijas de
 * 7/14/30 días (no sobre la ventana incremental del sync). Es la fuente de
 * verdad para OTB, ABC, criticidad de inventario y proyecciones.
 *
 * Antes se hacía `qty_ventana / 7`: con el backfill (~50 días) eso inflaba la
 * velocidad ~7×. Aquí se cuenta lo vendido dentro de cada ventana y se divide
 * por la ventana correcta. Productos sin ventas en 30 días → velocidad 0.
 */
export async function recomputeVelocities() {
  const nowMs = Date.now();
  const since = new Date(nowMs - 30 * 86_400_000);
  const posOrders = await odoo.getPosOrders(since);

  if (posOrders.length === 0) {
    await prisma.$executeRaw`UPDATE "ProductInsight" SET "avgDailySales7d" = 0, "avgDailySales14d" = 0, "avgDailySales30d" = 0`;
    await recomputeDaysOfStock();
    return;
  }

  // Timestamp (UTC) de cada orden para ubicarla en su ventana.
  const orderMs = new Map<number, number>();
  for (const o of posOrders) orderMs.set(o.id, new Date(o.date_order + "Z").getTime());

  const lines = await odoo.getPosOrderLines(posOrders.map((o) => o.id));
  const c7 = nowMs - 7 * 86_400_000;
  const c14 = nowMs - 14 * 86_400_000;
  const c30 = nowMs - 30 * 86_400_000;

  const byProduct = new Map<number, { q7: number; q14: number; q30: number; last: number }>();
  // Venta por producto y por dia: alimenta la desviacion estandar de la demanda
  // que usa el stock de seguridad. Se acumula aqui para no releer Odoo.
  const byProductDay = new Map<number, Map<number, number>>();
  for (const l of lines) {
    const t = orderMs.get(l.order_id[0]);
    if (t === undefined || t < c30) continue;
    const pid = l.product_id[0];
    const dayIdx = Math.floor((nowMs - t) / 86_400_000);
    const days = byProductDay.get(pid) ?? new Map<number, number>();
    days.set(dayIdx, (days.get(dayIdx) ?? 0) + l.qty);
    byProductDay.set(pid, days);
    const e = byProduct.get(pid) ?? { q7: 0, q14: 0, q30: 0, last: 0 };
    e.q30 += l.qty;
    if (t >= c14) e.q14 += l.qty;
    if (t >= c7) e.q7 += l.qty;
    if (t > e.last) e.last = t;
    byProduct.set(pid, e);
  }

  // Stubs para productos vendidos que no estén en la BD (archivados, etc.)
  const ids = Array.from(byProduct.keys());
  const existing = await prisma.productInsight.findMany({
    where: { odooProductId: { in: ids } },
    select: { odooProductId: true },
  });
  const existingIds = new Set(existing.map((e) => e.odooProductId));
  const missing = ids.filter((id) => !existingIds.has(id));
  if (missing.length > 0) {
    const stubs = await odoo.getProductsByIds(missing);
    await bulkUpsertProducts(
      stubs.map((p) => {
        const label = p.display_name || p.name;
        return {
          id: p.id,
          templateId: p.product_tmpl_id?.[0] ?? null,
          templateName: p.product_tmpl_id?.[1] ?? null,
          internalRef: p.default_code || null,
          name: p.active ? label : `${label} (archivado)`,
          category: p.categ_id?.[1] ?? null,
          stockQty: p.qty_available,
          cmp: p.standard_price,
          salePrice: p.list_price,
        };
      })
    );
  }

  // Resetear velocidades de TODOS y aplicar las reales a los vendidos en 30d.
  await prisma.$executeRaw`UPDATE "ProductInsight" SET "avgDailySales7d" = 0, "avgDailySales14d" = 0, "avgDailySales30d" = 0`;
  await bulkUpdateProductSales(
    Array.from(byProduct.entries()).map(([pid, e]) => ({
      pid,
      v7: e.q7 / 7,
      v14: e.q14 / 14,
      v30: e.q30 / 30,
      lastSoldIso: new Date(e.last).toISOString(),
      rotationDays: Math.floor((nowMs - e.last) / 86_400_000),
    }))
  );

  // Desviacion de la venta diaria sobre los 30 dias completos. Los dias sin
  // venta cuentan como cero a proposito: un producto que vende 10 un dia y
  // nada el resto es mucho mas volatil que uno que vende 1 cada dia, y ese
  // riesgo es justo lo que el stock de seguridad debe cubrir.
  const DIAS = 30;
  await bulkUpdateDemandStdDev(
    Array.from(byProductDay.entries()).map(([pid, days]) => {
      const media = Array.from(days.values()).reduce((a, b) => a + b, 0) / DIAS;
      let acc = 0;
      for (let d = 0; d < DIAS; d++) acc += ((days.get(d) ?? 0) - media) ** 2;
      return { pid, sd: Math.sqrt(acc / DIAS) };
    })
  );

  await recomputeDaysOfStock();
  await recomputeStockLevels();
}

export async function runFullSync() {
  // Secuencial (no Promise.allSettled) a propósito: los 3 jobs comparten el
  // mismo pooler de Supabase (pgbouncer). En paralelo competían por conexiones.
  // Con escrituras en lote (1 sentencia por lote) cada job termina en segundos,
  // así que en serie el total es bajo. Cada job maneja su propio estado, por eso
  // un fallo no aborta los siguientes.
  const jobs = [syncProducts, syncStock, syncSalesAndComputeMetrics, syncPurchases];
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
