import { prisma } from "@/lib/prisma";

const CAPTURE_KEY = "customer_capture_30d";

export interface CustomerCapture {
  orders: number;     // ventas POS de los ultimos 30 dias
  identified: number; // de esas, con cliente asignado en caja
  customers: number;  // clientes distintos identificados
  pct: number;        // identified / orders * 100
  measuredAt: string; // ISO del sync que lo midio
}

/**
 * Cuantas ventas se registran con cliente en el POS. Sin cliente no hay
 * recompra, segmentos RFM ni campañas de reactivacion: este numero es el
 * cuello de botella de todo el modulo comercial (en oct-2026 era 0 de 10.229).
 *
 * Lo mide el sync al recalcular velocidades — ya trae las ordenes de 30 dias
 * con su partner — y lo deja en Setting para no consultar Odoo al renderizar.
 */
export async function saveCustomerCapture(
  orders: Array<{ partner_id: [number, string] | false }>
): Promise<void> {
  const ids = orders.flatMap((o) => (o.partner_id ? [o.partner_id[0]] : []));
  const value: CustomerCapture = {
    orders: orders.length,
    identified: ids.length,
    customers: new Set(ids).size,
    pct: orders.length > 0 ? (ids.length / orders.length) * 100 : 0,
    measuredAt: new Date().toISOString(),
  };
  const json = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key: CAPTURE_KEY },
    create: { key: CAPTURE_KEY, value: json },
    update: { value: json },
  });
}

export async function getCustomerCapture(): Promise<CustomerCapture | null> {
  const row = await prisma.setting.findUnique({ where: { key: CAPTURE_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as CustomerCapture;
  } catch {
    return null;
  }
}
