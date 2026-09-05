import { odooRpc } from "@/lib/odoo";
import { translateOdooError } from "@/lib/odoo-write";
import { assertModelAllowed, assertWritable, toOdooValues } from "./write-guard";
import type { BulkResult, TemplatePatch } from "./types";

/**
 * Escritura de catalogo hacia Odoo. Hermano de src/lib/odoo-write.ts y con el
 * mismo contrato:
 *  - Solo se invoca desde server actions disparadas por un clic del usuario.
 *    Ningun sync, cron o route handler la importa.
 *  - Solo escribe atributos de catalogo. La lista blanca de write-guard.ts
 *    garantiza que no pueda tocar inventario.
 */

const MODEL = "product.template";

/** Mismo tope que odoo-write.ts: el cliente compartido no acota por defecto. */
const ODOO_WRITE_TIMEOUT_MS = 60_000;

/**
 * Tamaño de lote. 50 mantiene el payload chico y el tiempo por llamada bien
 * debajo del timeout, incluso con los recalculos que Odoo dispara al cambiar
 * categoria en productos con historial.
 */
const BATCH_SIZE = 50;

export async function updateTemplates(ids: number[], patch: TemplatePatch): Promise<BulkResult> {
  if (ids.length === 0) return { ok: [], failed: [] };

  assertModelAllowed(MODEL);
  const values = toOdooValues(patch);
  if (Object.keys(values).length === 0) {
    throw new Error("El cambio masivo no trae ningun campo: patch sin cambios");
  }
  assertWritable(values);

  const result: BulkResult = { ok: [], failed: [] };

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const lote = ids.slice(i, i + BATCH_SIZE);
    try {
      await write(lote, values);
      result.ok.push(...lote);
    } catch (err) {
      if (!esRechazoDeNegocio(err)) {
        // Odoo no respondio. Aislar aqui seria repetir el mismo timeout 50
        // veces: 50 x 60s = 50 minutos con la accion del servidor colgada,
        // para descubrir lo que ya sabemos. Se marca lo que queda como
        // fallido y se corta, para devolver un resultado honesto en segundos.
        const mensaje = translateOdooError(err, "catalogo");
        for (const id of ids.slice(i)) result.failed.push({ id, error: mensaje });
        return result;
      }
      // Rechazo de negocio: Odoo no dice CUAL producto lo causo, asi que se
      // reintenta uno a uno para poder nombrar al culpable. Reportar 50
      // fallos cuando solo uno esta archivado le quitaria el cambio a 49.
      for (const id of lote) {
        try {
          await write([id], values);
          result.ok.push(id);
        } catch (errItem) {
          result.failed.push({ id, error: translateOdooError(errItem, "catalogo") });
        }
      }
    }
  }

  return result;
}

/**
 * Distingue un rechazo de negocio de Odoo (producto archivado, impuesto
 * inexistente) de un fallo de transporte (red caida, HTTP no-OK, timeout).
 *
 * Es la misma distincion que hace `translateOdooError` para redactar el
 * mensaje: el cliente antepone "Odoo RPC error:" cuando llego al servidor y
 * este respondio con un error de negocio. Sin respuesta de negocio, el fallo
 * es de transporte y reintentar linea por linea no descubre nada.
 */
function esRechazoDeNegocio(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.toLowerCase().includes("odoo rpc error");
}

function write(ids: number[], values: Record<string, unknown>): Promise<boolean> {
  return odooRpc.executeKw<boolean>(MODEL, "write", [ids, values], {}, ODOO_WRITE_TIMEOUT_MS);
}
