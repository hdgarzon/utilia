/**
 * Cliente JSON-RPC para Odoo.sh
 *
 * Odoo NO acepta `Authorization: Bearer`. Usa el endpoint /jsonrpc con:
 *  1. service="common" + method="authenticate" → devuelve uid numérico
 *  2. service="object" + method="execute_kw"   → CRUD sobre cualquier modelo
 *
 * La API key generada en "Mi perfil → Seguridad" reemplaza la contraseña.
 */

const ODOO_BASE_URL = process.env.ODOO_BASE_URL!;
const ODOO_DB = process.env.ODOO_DB!;
const ODOO_LOGIN = process.env.ODOO_LOGIN!;
const ODOO_API_KEY = process.env.ODOO_API_KEY!;

// Cache global del UID autenticado (válido mientras la API key esté activa)
let cachedUid: number | null = null;

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

async function jsonRpc<T>(service: string, method: string, args: unknown[]): Promise<T> {
  const res = await fetch(`${ODOO_BASE_URL}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      id: Date.now(),
      params: { service, method, args },
    }),
  });

  if (!res.ok) {
    throw new Error(`Odoo HTTP ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as JsonRpcResponse<T>;
  if (data.error) {
    throw new Error(`Odoo RPC error: ${data.error.message} ${JSON.stringify(data.error.data ?? "")}`);
  }
  if (data.result === undefined) {
    throw new Error("Odoo RPC returned no result");
  }
  return data.result;
}

/** Autentica contra Odoo y devuelve el UID numérico del usuario. Se cachea. */
async function authenticate(): Promise<number> {
  if (cachedUid !== null) return cachedUid;

  const uid = await jsonRpc<number | false>("common", "authenticate", [
    ODOO_DB,
    ODOO_LOGIN,
    ODOO_API_KEY,
    {},
  ]);

  if (uid === false || uid === 0) {
    throw new Error(
      `Odoo authentication failed. Verifica ODOO_DB="${ODOO_DB}", ODOO_LOGIN y ODOO_API_KEY.`
    );
  }

  cachedUid = uid as number;
  return cachedUid;
}

/** Ejecuta un método sobre un modelo de Odoo. */
async function executeKw<T>(
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {}
): Promise<T> {
  const uid = await authenticate();
  return jsonRpc<T>("object", "execute_kw", [
    ODOO_DB,
    uid,
    ODOO_API_KEY,
    model,
    method,
    args,
    kwargs,
  ]);
}

/** Helper para search_read con dominios y campos. */
async function searchRead<T>(
  model: string,
  domain: unknown[] = [],
  fields: string[] = [],
  options: { limit?: number; offset?: number; order?: string } = {}
): Promise<T[]> {
  return executeKw<T[]>(model, "search_read", [domain], {
    fields,
    limit: options.limit ?? 1000,
    offset: options.offset ?? 0,
    order: options.order ?? "id desc",
  });
}

// ─── Tipos de datos de Odoo ──────────────────────────────────────────────────

export interface OdooSaleOrder {
  id: number;
  name: string;
  date_order: string;
  amount_total: number;
  amount_untaxed: number;
  state: string;
  partner_id: [number, string];
  order_line: number[];
}

export interface OdooSaleOrderLine {
  id: number;
  order_id: [number, string];
  product_id: [number, string];
  product_uom_qty: number;
  price_unit: number;
  price_subtotal: number;
  // `purchase_price` solo existe si el módulo `sale_margin` está instalado.
  // Es el costo histórico al momento de confirmar la venta (mejor que
  // standard_price actual porque captura precios pasados).
  purchase_price?: number | false;
  // `margin` es purchase_price * qty restado de price_subtotal, computado.
  margin?: number | false;
}

export interface OdooStockQuant {
  id: number;
  product_id: [number, string];
  location_id: [number, string];
  quantity: number;
  reserved_quantity: number;
}

export interface OdooProduct {
  id: number;
  name: string;
  // display_name incluye los atributos de la variante, ej:
  // "VELA CUMPLEAÑOS NUMERO METALIZADA 0-9 (Número: 5)". `name` solo trae el
  // nombre del template (igual para todas las variantes), por eso usamos este.
  display_name: string;
  default_code: string | false;
  categ_id: [number, string];
  product_tmpl_id: [number, string];
  list_price: number;
  standard_price: number;
  qty_available: number;
  active: boolean;
}

export interface OdooPartner {
  id: number;
  name: string;
  email: string | false;
  phone: string | false;
  mobile: string | false;
  birthday: string | false;
}

/** POS = Point of Sale. Modelo paralelo a sale.order pero para caja registradora. */
export interface OdooPosOrder {
  id: number;
  name: string;
  date_order: string;
  amount_total: number;
  amount_paid: number;
  state: string; // "draft" | "paid" | "done" | "invoiced" | "cancel"
  partner_id: [number, string] | false;
  lines: number[];
  session_id: [number, string];
}

export interface OdooPosOrderLine {
  id: number;
  order_id: [number, string];
  product_id: [number, string];
  qty: number;
  price_unit: number;
  price_subtotal: number;
  discount: number;
  // total_cost = qty × costo unitario al momento de la venta (histórico, ideal)
  total_cost: number;
}

// ─── API pública ─────────────────────────────────────────────────────────────

export const odoo = {
  /** Verifica conectividad: hace authenticate y devuelve metadata mínima. */
  async testConnection(): Promise<{ ok: true; uid: number; db: string; serverVersion?: string }> {
    const uid = await authenticate();
    let serverVersion: string | undefined;
    try {
      const version = await jsonRpc<{ server_version?: string }>("common", "version", []);
      serverVersion = version.server_version;
    } catch {
      /* version() es opcional */
    }
    return { ok: true, uid, db: ODOO_DB, serverVersion };
  },

  async getSaleOrders(since?: Date): Promise<OdooSaleOrder[]> {
    const domain: unknown[] = [["state", "in", ["sale", "done"]]];
    if (since) domain.push(["write_date", ">=", formatOdooDate(since)]);

    return searchRead<OdooSaleOrder>(
      "sale.order",
      domain,
      ["id", "name", "date_order", "amount_total", "amount_untaxed", "state", "partner_id", "order_line"],
      { limit: 1000, order: "date_order desc" }
    );
  },

  async getSaleOrderLines(orderIds: number[]): Promise<OdooSaleOrderLine[]> {
    if (orderIds.length === 0) return [];
    // Pedimos purchase_price y margin; Odoo los ignora si el módulo no está
    // instalado (campos opcionales en el resultado).
    const fields = [
      "id",
      "order_id",
      "product_id",
      "product_uom_qty",
      "price_unit",
      "price_subtotal",
      "purchase_price",
      "margin",
    ];
    try {
      return await searchRead<OdooSaleOrderLine>(
        "sale.order.line",
        [["order_id", "in", orderIds]],
        fields,
        { limit: 5000 }
      );
    } catch {
      // Si purchase_price/margin no existen (sale_margin no instalado), reintentar sin ellos
      return searchRead<OdooSaleOrderLine>(
        "sale.order.line",
        [["order_id", "in", orderIds]],
        ["id", "order_id", "product_id", "product_uom_qty", "price_unit", "price_subtotal"],
        { limit: 5000 }
      );
    }
  },

  async getStockQuants(): Promise<OdooStockQuant[]> {
    return searchRead<OdooStockQuant>(
      "stock.quant",
      [["location_id.usage", "=", "internal"]],
      ["id", "product_id", "location_id", "quantity", "reserved_quantity"],
      { limit: 2000 }
    );
  },

  /**
   * Obtiene productos vendibles (product.product, no product.template).
   * Importante: las líneas de venta apuntan a product.product, no a templates.
   * Por defecto solo los activos; `opts.includeArchived` los trae todos.
   */
  async getProducts(
    since?: Date,
    opts: { includeArchived?: boolean } = {}
  ): Promise<OdooProduct[]> {
    // Odoo aplica `active = true` por defecto. Para traer inactivos hay que
    // usar el operador OR explícito ('|' active=true active=false).
    const domain: unknown[] = opts.includeArchived
      ? ["|", ["active", "=", true], ["active", "=", false]]
      : [["active", "=", true]];
    if (since) domain.push(["write_date", ">=", formatOdooDate(since)]);

    return searchRead<OdooProduct>(
      "product.product",
      domain,
      ["id", "name", "display_name", "default_code", "categ_id", "product_tmpl_id", "list_price", "standard_price", "qty_available", "active"],
      { limit: 5000 }
    );
  },

  /** Obtiene una lista específica de productos por ID (incluso archivados). */
  async getProductsByIds(ids: number[]): Promise<OdooProduct[]> {
    if (ids.length === 0) return [];
    const result = await searchRead<OdooProduct>(
      "product.product",
      ["|", ["active", "=", true], ["active", "=", false], ["id", "in", ids]],
      ["id", "name", "display_name", "default_code", "categ_id", "product_tmpl_id", "list_price", "standard_price", "qty_available", "active"],
      { limit: ids.length }
    );
    // Odoo no garantiza el orden; devolvemos en orden solicitado
    const byId = new Map(result.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as OdooProduct[];
  },

  /** Trae órdenes POS pagadas/cerradas. Paginado porque pueden ser miles. */
  async getPosOrders(since?: Date, limit = 5000): Promise<OdooPosOrder[]> {
    const domain: unknown[] = [["state", "in", ["paid", "done", "invoiced"]]];
    if (since) domain.push(["write_date", ">=", formatOdooDate(since)]);

    return searchRead<OdooPosOrder>(
      "pos.order",
      domain,
      ["id", "name", "date_order", "amount_total", "amount_paid", "state", "partner_id", "lines", "session_id"],
      { limit, order: "date_order desc" }
    );
  },

  /** Trae las órdenes POS de hoy (UTC-5) agregadas por hora local. */
  async getTodayHourlySales(): Promise<Array<{ hour: number; revenue: number; transactions: number }>> {
    // Colombia siempre es UTC-5 (sin horario de verano). Calcular "inicio
    // de hoy en Colombia" y "inicio de mañana en Colombia" expresados en UTC.
    const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000;
    const nowMs = Date.now();
    // Shift al "reloj de Colombia"
    const colombiaNow = new Date(nowMs - COLOMBIA_OFFSET_MS);
    // Medianoche Colombia (en el espacio de UTC shifteado)
    const colombiaMidnight = new Date(colombiaNow);
    colombiaMidnight.setUTCHours(0, 0, 0, 0);
    // Volver al espacio UTC real
    const start = new Date(colombiaMidnight.getTime() + COLOMBIA_OFFSET_MS);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const orders = await searchRead<{ date_order: string; amount_total: number }>(
      "pos.order",
      [
        ["state", "in", ["paid", "done", "invoiced"]],
        ["date_order", ">=", formatOdooDate(start)],
        ["date_order", "<", formatOdooDate(end)],
      ],
      ["date_order", "amount_total"],
      { limit: 500, order: "date_order asc" }
    );

    // Bucket por hora local de Colombia
    const byHour = new Map<number, { revenue: number; transactions: number }>();
    for (let h = 7; h <= 21; h++) byHour.set(h, { revenue: 0, transactions: 0 });

    for (const o of orders) {
      // date_order viene en UTC; convertir a hora Colombia (UTC-5)
      const dt = new Date(o.date_order + "Z");
      const hourCO = (dt.getUTCHours() - 5 + 24) % 24;
      const bucket = byHour.get(hourCO);
      if (bucket) {
        bucket.revenue += o.amount_total;
        bucket.transactions += 1;
      }
    }

    return Array.from(byHour.entries())
      .sort(([a], [b]) => a - b)
      .map(([hour, data]) => ({ hour, ...data }));
  },

  async getPosOrderLines(orderIds: number[]): Promise<OdooPosOrderLine[]> {
    if (orderIds.length === 0) return [];
    // Chunking en lotes de 500 para evitar payload gigante en la respuesta
    const CHUNK = 500;
    const all: OdooPosOrderLine[] = [];
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      const slice = orderIds.slice(i, i + CHUNK);
      const lines = await searchRead<OdooPosOrderLine>(
        "pos.order.line",
        [["order_id", "in", slice]],
        ["id", "order_id", "product_id", "qty", "price_unit", "price_subtotal", "discount", "total_cost"],
        { limit: 50000 }
      );
      all.push(...lines);
    }
    return all;
  },

  async getPartners(since?: Date): Promise<OdooPartner[]> {
    const domain: unknown[] = [["customer_rank", ">", 0]];
    if (since) domain.push(["write_date", ">=", formatOdooDate(since)]);

    return searchRead<OdooPartner>(
      "res.partner",
      domain,
      ["id", "name", "email", "phone", "mobile", "birthday"],
      { limit: 5000 }
    );
  },
};

/** Formato datetime que Odoo espera: "YYYY-MM-DD HH:MM:SS" (UTC). */
function formatOdooDate(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}
