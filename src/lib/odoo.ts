const ODOO_BASE_URL = process.env.ODOO_BASE_URL!;
const ODOO_API_KEY = process.env.ODOO_API_KEY!;
const ODOO_DB = process.env.ODOO_DB!;

interface OdooRequestOptions {
  model: string;
  method: string;
  args?: unknown[];
  kwargs?: Record<string, unknown>;
}

async function odooRPC<T>(options: OdooRequestOptions): Promise<T> {
  const { model, method, args = [], kwargs = {} } = options;

  const res = await fetch(`${ODOO_BASE_URL}/web/dataset/call_kw`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ODOO_API_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      id: Date.now(),
      params: {
        model,
        method,
        args,
        kwargs: { ...kwargs, context: {} },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Odoo API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`Odoo RPC error: ${JSON.stringify(data.error)}`);
  }
  return data.result as T;
}

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
  standard_price: number;
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
  default_code: string;
  categ_id: [number, string];
  list_price: number;
  standard_price: number;
  qty_available: number;
  active: boolean;
}

export interface OdooPartner {
  id: number;
  name: string;
  email: string;
  phone: string;
  mobile: string;
  birthday: string;
}

export const odoo = {
  async getSaleOrders(since?: Date): Promise<OdooSaleOrder[]> {
    const domain: unknown[] = [["state", "in", ["sale", "done"]]];
    if (since) {
      domain.push(["write_date", ">=", since.toISOString()]);
    }
    return odooRPC<OdooSaleOrder[]>({
      model: "sale.order",
      method: "search_read",
      args: [domain],
      kwargs: {
        fields: ["id", "name", "date_order", "amount_total", "amount_untaxed", "state", "partner_id", "order_line"],
        limit: 1000,
        order: "date_order desc",
      },
    });
  },

  async getSaleOrderLines(orderIds: number[]): Promise<OdooSaleOrderLine[]> {
    return odooRPC<OdooSaleOrderLine[]>({
      model: "sale.order.line",
      method: "search_read",
      args: [[["order_id", "in", orderIds]]],
      kwargs: {
        fields: ["id", "order_id", "product_id", "product_uom_qty", "price_unit", "price_subtotal"],
        limit: 5000,
      },
    });
  },

  async getStockQuants(): Promise<OdooStockQuant[]> {
    return odooRPC<OdooStockQuant[]>({
      model: "stock.quant",
      method: "search_read",
      args: [[["location_id.usage", "=", "internal"]]],
      kwargs: {
        fields: ["id", "product_id", "location_id", "quantity", "reserved_quantity"],
        limit: 2000,
      },
    });
  },

  async getProducts(since?: Date): Promise<OdooProduct[]> {
    const domain: unknown[] = [["active", "=", true]];
    if (since) {
      domain.push(["write_date", ">=", since.toISOString()]);
    }
    return odooRPC<OdooProduct[]>({
      model: "product.template",
      method: "search_read",
      args: [domain],
      kwargs: {
        fields: ["id", "name", "default_code", "categ_id", "list_price", "standard_price", "qty_available"],
        limit: 2000,
      },
    });
  },

  async getPartners(since?: Date): Promise<OdooPartner[]> {
    const domain: unknown[] = [["customer_rank", ">", 0]];
    if (since) {
      domain.push(["write_date", ">=", since.toISOString()]);
    }
    return odooRPC<OdooPartner[]>({
      model: "res.partner",
      method: "search_read",
      args: [domain],
      kwargs: {
        fields: ["id", "name", "email", "phone", "mobile", "birthday"],
        limit: 5000,
      },
    });
  },

  async testConnection(): Promise<boolean> {
    try {
      await odooRPC({
        model: "res.users",
        method: "search_read",
        args: [[["id", "=", 1]]],
        kwargs: { fields: ["id", "name"], limit: 1 },
      });
      return true;
    } catch {
      return false;
    }
  },
};
