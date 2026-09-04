import type { TemplatePatch } from "./types";

/**
 * Barrera de escritura del catalogo. Sin imports de Odoo, Prisma ni entorno:
 * tiene que poder probarse sola, porque es la garantia de que Utilia nunca
 * mueve inventario en produccion.
 *
 * La lista es EXACTAMENTE lo que el modulo escribe hoy, ni un campo mas:
 * los cinco que produce `toOdooValues`. `qty_available`,
 * `inventory_quantity` y `free_qty` quedan fuera por construccion.
 *
 * Regla para mantenerla: un campo entra a esta lista en el MISMO cambio que
 * introduce quien lo escribe, nunca antes. Una lista con campos sin escritor
 * es una puerta abierta sin nadie que la use.
 *
 * Por eso no estan todavia los campos de creacion de producto (`name`,
 * `type`, `is_storable`, `list_price`, `image_1920`, `show_availability`,
 * `standard_price`): los escribe `createTemplate`, que es Fase 2. Dos de
 * ellos son delicados y merecen mencion aparte: `is_storable` ES el rastreo
 * de inventario, y escribir `standard_price` sobre un producto con stock
 * dispara una revalorizacion contable en Odoo (seguro solo al crear, con
 * stock en 0). `list_price` ademas quedo fuera de la edicion masiva de la
 * v1 por prudencia comercial (ver spec).
 */
export const WRITABLE_FIELDS: ReadonlySet<string> = new Set([
  "categ_id",
  "is_published",
  "public_categ_ids",
  "supplier_taxes_id",
  "seller_ids",
]);

/** Escribir en cualquiera de estos genera movimiento de inventario. */
const FORBIDDEN_MODELS: ReadonlySet<string> = new Set([
  "stock.quant",
  "stock.move",
  "stock.inventory",
]);

export function assertWritable(values: Record<string, unknown>): void {
  for (const campo of Object.keys(values)) {
    if (!WRITABLE_FIELDS.has(campo)) {
      throw new Error(`Campo no permitido en escritura de catalogo: ${campo}`);
    }
  }
}

export function assertModelAllowed(model: string): void {
  if (FORBIDDEN_MODELS.has(model)) {
    throw new Error(`Modelo prohibido: ${model} — este modulo no puede tocar inventario`);
  }
}

/**
 * Traduce la intencion de la app a valores de Odoo. Las claves ausentes en el
 * patch no aparecen en el resultado: un `undefined` enviado a Odoo borraria
 * el valor existente.
 */
export function toOdooValues(patch: TemplatePatch): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  if (patch.categoryId !== undefined) v.categ_id = patch.categoryId;
  if (patch.isPublished !== undefined) v.is_published = patch.isPublished;
  // Comando 6 de Odoo: reemplazar el conjunto completo del many2many.
  if (patch.publicCategoryIds !== undefined) v.public_categ_ids = [[6, 0, patch.publicCategoryIds]];
  if (patch.purchaseTaxIds !== undefined) v.supplier_taxes_id = [[6, 0, patch.purchaseTaxIds]];
  // Comando 5 (limpiar) + 0 (crear): el proveedor nuevo REEMPLAZA a los que
  // hubiera. Es destructivo a proposito; la UI avisa antes de confirmar.
  if (patch.supplierPartnerId !== undefined) {
    v.seller_ids = [
      [5, 0, 0],
      [0, 0, { partner_id: patch.supplierPartnerId }],
    ];
  }
  return v;
}
