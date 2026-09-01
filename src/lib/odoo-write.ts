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

/**
 * Tope de tiempo SOLO para este camino de escritura (el cliente Odoo
 * compartido no tiene timeout por defecto — ver src/lib/odoo.ts — porque el
 * sync y las lecturas pueden tardar legítimamente mucho).
 *
 * Relación con el reclamo de `retryOdooDraft` (`CLAIM_STALE_AFTER_MS = 5
 * min` en actions.ts): un reclamo se considera abandonado y retomable a los
 * 5 minutos. Para que esa suposición sea cierta, el intento original tiene
 * que estar GARANTIZADO a haber terminado (éxito o error) mucho antes de
 * esos 5 minutos — si no, un segundo llamador podría retomar el reclamo
 * mientras el primero todavía sigue creando el borrador, y terminaríamos con
 * dos órdenes reales en Odoo (el bug que este timeout cierra).
 *
 * Con 60s por llamada RPC: el peor caso de `createDraftPurchaseOrder` son
 * dos llamadas HTTP secuenciales (`create` y, si hace falta autenticar de
 * cero, su propio `authenticate` interno; luego el `search_read` del
 * nombre, que reutiliza el uid ya cacheado). Peor caso ≈ 60s (authenticate)
 * + 60s (create) + 60s (search_read) = 180s = 3 min, con margen cómodo
 * bajo los 5 min del reclamo.
 */
const ODOO_WRITE_TIMEOUT_MS = 60_000;

export async function createDraftPurchaseOrder(input: {
  odooPartnerId: number;
  originRef: string; // trazabilidad: "UTILIA-REP-<id>" en el campo origin
  lines: Array<{ odooProductId: number; qty: number; priceUnit: number }>;
}): Promise<{ odooOrderId: number; odooOrderName: string }> {
  const { odooPartnerId, originRef, lines } = input;
  if (lines.length === 0) throw new Error("El pedido no tiene líneas");

  const odooOrderId = await odooRpc.executeKw<number>(
    "purchase.order",
    "create",
    [
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
    ],
    {},
    ODOO_WRITE_TIMEOUT_MS
  );

  // El create ya tuvo éxito: el pedido existe en Odoo con este id. Si esta
  // lectura falla (p. ej. un corte de red justo después), NO hay que perder
  // el id ya creado -- el llamador lo necesita para no crear un duplicado al
  // reintentar. Solo el fallo del create de arriba debe propagarse.
  let odooOrderName = `#${odooOrderId}`;
  try {
    const rows = await odooRpc.searchRead<{ id: number; name: string }>(
      "purchase.order",
      [["id", "=", odooOrderId]],
      ["id", "name"],
      { limit: 1, timeoutMs: ODOO_WRITE_TIMEOUT_MS }
    );
    if (rows[0]?.name) odooOrderName = rows[0].name;
  } catch (err) {
    console.error(`[odoo-write] borrador creado (id=${odooOrderId}) pero fallo la lectura del nombre:`, err);
  }
  return { odooOrderId, odooOrderName };
}

/**
 * Traduce un error del cliente Odoo (que puede incluir un traceback de
 * Python embebido en JSON, ver `Odoo RPC error` en src/lib/odoo.ts) a un
 * mensaje corto en español apto para un toast. El error técnico completo se
 * registra con `console.error` para diagnóstico; nunca se expone al usuario.
 */
export function translateOdooError(err: unknown): string {
  console.error("[odoo-write] error al escribir en Odoo:", err);
  const raw = err instanceof Error ? err.message : String(err);

  // Errores de validación propios: ya son cortos y claros, se muestran tal cual.
  if (raw === "El pedido no tiene líneas") return raw;

  const lower = raw.toLowerCase();

  // "Odoo RPC error: <mensaje de negocio> <json con traceback>" -- llegamos
  // al servidor y respondió con un error de negocio o de permisos.
  if (lower.includes("odoo rpc error")) {
    if (
      lower.includes("access") ||
      lower.includes("permis") ||
      lower.includes("allowed") ||
      lower.includes("denied") ||
      lower.includes("forbidden")
    ) {
      return "El usuario de la API no tiene permisos para crear órdenes de compra en Odoo. Revisa el grupo de Compras del usuario.";
    }
    if (lower.includes("partner")) {
      return "El proveedor no es válido en Odoo (revisa que el contacto exista y no esté archivado).";
    }
    if (lower.includes("product")) {
      return "Uno de los productos no es válido en Odoo (revisa que no esté archivado o eliminado).";
    }
    return "No se pudo crear el borrador en Odoo. Revisa la conexión e intenta de nuevo.";
  }

  // No hubo respuesta de negocio de Odoo: fallo de red, HTTP no-OK o
  // autenticación (ver jsonRpc/authenticate en src/lib/odoo.ts).
  return "No se pudo conectar con Odoo. Revisa la conexión e intenta de nuevo.";
}
