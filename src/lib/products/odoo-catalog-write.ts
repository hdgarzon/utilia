import { odooRpc } from "@/lib/odoo";
import { translateOdooError } from "@/lib/odoo-write";
import {
  assertModelAllowed,
  assertWritableOnUpdate,
  assertWritableOnCreate,
  assertWritableOnOrderpoint,
  toOdooValues,
  toOdooCreateValues,
  toOdooOrderpointValues,
} from "./write-guard";
import type { BulkResult, TemplatePatch } from "./types";
import type { ProductCreateInput } from "./import-types";

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
  assertWritableOnUpdate(values);

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

/**
 * Crea UNA plantilla de producto en Odoo y devuelve su id.
 *
 * Se llama en serie desde la creacion por tandas: Odoo.sh estrangula la
 * concurrencia, y en serie los resultados se corresponden fila a fila.
 *
 * Crear un producto NO mueve inventario: nace en cero. La cantidad a la mano
 * se captura en la hoja y se exporta como pendiente, nunca se escribe.
 */
export async function createTemplate(
  row: ProductCreateInput,
  imageBase64: string | null
): Promise<number> {
  assertModelAllowed(MODEL);
  const values = toOdooCreateValues(row, imageBase64);
  assertWritableOnCreate(values);

  return odooRpc.executeKw<number>(MODEL, "create", [values], {}, ODOO_WRITE_TIMEOUT_MS);
}

const MODELO_REGLA = "stock.warehouse.orderpoint";

/**
 * Almacen y su ubicacion de stock. Se lee una vez por proceso: la tienda
 * tiene un solo almacen y no cambia entre filas de una tanda.
 *
 * La ubicacion sale de `lot_stock_id` del almacen y NO escrita a mano: da
 * WH/Sabaneta, que es la que usan las 1.548 reglas que ya existen. Una
 * ubicacion inventada crearia reglas que no vigilan nada.
 */
let almacenCache: { warehouseId: number; locationId: number } | null = null;

export async function resolverAlmacen(): Promise<{ warehouseId: number; locationId: number }> {
  if (almacenCache) return almacenCache;
  const [w] = await odooRpc.searchRead<{ id: number; lot_stock_id: [number, string] | false }>(
    "stock.warehouse",
    [],
    ["id", "lot_stock_id"],
    { limit: 1 }
  );
  if (!w || !w.lot_stock_id) {
    throw new Error("Odoo no devolvio un almacen con ubicacion de stock");
  }
  almacenCache = { warehouseId: w.id, locationId: w.lot_stock_id[0] };
  return almacenCache;
}

/**
 * Crea la regla de reabastecimiento de un producto recien dado de alta.
 *
 * Se llama DESPUES de `createTemplate` y su fallo NO puede costar el
 * producto: la fila queda OK con una advertencia, igual que cuando no se
 * puede bajar la imagen. Volver a intentar la fila entera recrearia el
 * producto, que es peor que quedarse sin la regla.
 *
 * Odoo pide la VARIANTE (`product.product`), no la plantilla, asi que hay que
 * leerla de vuelta. Un producto recien creado sin atributos tiene exactamente
 * una.
 */
export async function createOrderpoint(
  templateId: number,
  min: number,
  max: number
): Promise<number> {
  assertModelAllowed(MODELO_REGLA);
  const { warehouseId, locationId } = await resolverAlmacen();

  const [tpl] = await odooRpc.executeKw<Array<{ product_variant_id: [number, string] | false }>>(
    MODEL,
    "read",
    [[templateId], ["product_variant_id"]]
  );
  if (!tpl || !tpl.product_variant_id) {
    throw new Error(`La plantilla ${templateId} no tiene variante`);
  }

  const values = toOdooOrderpointValues({
    productVariantId: tpl.product_variant_id[0],
    warehouseId,
    locationId,
    min,
    max,
  });
  assertWritableOnOrderpoint(values);

  return odooRpc.executeKw<number>(MODELO_REGLA, "create", [values], {}, ODOO_WRITE_TIMEOUT_MS);
}
