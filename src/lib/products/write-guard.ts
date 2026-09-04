import type { TemplatePatch } from "./types";

/**
 * Barrera de escritura del catalogo. Sin imports de Odoo, Prisma ni entorno:
 * tiene que poder probarse sola, porque es la garantia de que Utilia nunca
 * mueve inventario en produccion.
 *
 * La lista es EXACTAMENTE lo que el modulo escribe, ni un campo mas.
 * `qty_available`, `inventory_quantity` y `free_qty` quedan fuera por
 * construccion, no por olvido.
 *
 * `standard_price` NO esta en la lista: en Fase 1 no se crean productos, y
 * escribir el costo sobre un producto con stock dispara una revalorizacion
 * contable de inventario en Odoo. Se agregara cuando exista la carga masiva.
 */
export const WRITABLE_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "type",
  "is_storable",
  "list_price",
  "categ_id",
  "supplier_taxes_id",
  "seller_ids",
  "image_1920",
  "is_published",
  "public_categ_ids",
  "show_availability",
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
