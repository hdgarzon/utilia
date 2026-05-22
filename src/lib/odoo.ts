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
  default_code: string | false;
  categ_id: [number, string];
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
    return searchRead<OdooSaleOrderLine>(
      "sale.order.line",
      [["order_id", "in", orderIds]],
      ["id", "order_id", "product_id", "product_uom_qty", "price_unit", "price_subtotal"],
      { limit: 5000 }
    );
  },

  async getStockQuants(): Promise<OdooStockQuant[]> {
    return searchRead<OdooStockQuant>(
      "stock.quant",
      [["location_id.usage", "=", "internal"]],
      ["id", "product_id", "location_id", "quantity", "reserved_quantity"],
      { limit: 2000 }
    );
  },

  async getProducts(since?: Date): Promise<OdooProduct[]> {
    const domain: unknown[] = [["active", "=", true]];
    if (since) domain.push(["write_date", ">=", formatOdooDate(since)]);

    return searchRead<OdooProduct>(
      "product.template",
      domain,
      ["id", "name", "default_code", "categ_id", "list_price", "standard_price", "qty_available"],
      { limit: 2000 }
    );
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
