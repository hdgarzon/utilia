import { odooRpc } from "@/lib/odoo";

/**
 * ÚNICA escritura permitida hacia Odoo desde la app.
 *
 * Contrato:
 *  - Solo se invoca desde server actions disparadas por un clic del usuario
 *    (aprobar/reintentar pedido). Ningún sync, cron o route handler la importa.
 *  - Solo crea `purchase.order` en estado BORRADOR: no toca stock, gasto ni
 *    contabilidad. El borrador se confirma (o cancela) manualmente en Odoo.
 *  - El sync ignora borradores (filtra state purchase/done), así que no hay
 *    doble conteo de gasto.
 */
export async function createDraftPurchaseOrder(input: {
  odooPartnerId: number;
  originRef: string; // trazabilidad: "UTILIA-REP-<id>" en el campo origin
  lines: Array<{ odooProductId: number; qty: number; priceUnit: number }>;
}): Promise<{ odooOrderId: number; odooOrderName: string }> {
  const { odooPartnerId, originRef, lines } = input;
  if (lines.length === 0) throw new Error("El pedido no tiene líneas");

  const odooOrderId = await odooRpc.executeKw<number>("purchase.order", "create", [
    {
      partner_id: odooPartnerId,
      origin: originRef,
      order_line: lines.map((l) => [
        0,
        0,
        // price_unit = CMP como estimado honesto; el precio real se ajusta en
        // Odoo al confirmar si el proveedor cambió la lista.
        { product_id: l.odooProductId, product_qty: l.qty, price_unit: l.priceUnit },
      ]),
    },
  ]);

  const rows = await odooRpc.searchRead<{ id: number; name: string }>(
    "purchase.order",
    [["id", "=", odooOrderId]],
    ["id", "name"],
    { limit: 1 }
  );
  return { odooOrderId, odooOrderName: rows[0]?.name ?? `#${odooOrderId}` };
}
