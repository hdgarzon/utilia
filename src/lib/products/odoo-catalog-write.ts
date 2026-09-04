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
    } catch {
      // El lote fallo pero Odoo no dice por cual producto. Se reintenta uno a
      // uno para poder nombrar al culpable: reportar 50 fallos cuando solo uno
      // esta archivado le haria perder el cambio a los otros 49.
      for (const id of lote) {
        try {
          await write([id], values);
          result.ok.push(id);
        } catch (err) {
          result.failed.push({ id, error: translateOdooError(err) });
        }
      }
    }
  }

  return result;
}

function write(ids: number[], values: Record<string, unknown>): Promise<boolean> {
  return odooRpc.executeKw<boolean>(MODEL, "write", [ids, values], {}, ODOO_WRITE_TIMEOUT_MS);
}
