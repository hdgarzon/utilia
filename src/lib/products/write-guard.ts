import type { TemplatePatch } from "./types";
import type { ProductCreateInput } from "./import-types";

/**
 * Barrera de escritura del catalogo. Sin imports de Odoo, Prisma ni entorno:
 * tiene que poder probarse sola, porque es la garantia de que Utilia nunca
 * mueve inventario en produccion.
 *
 * Son DOS listas, no una, y la diferencia importa:
 *
 *  - `UPDATE_FIELDS` es lo que se puede escribir sobre un producto que ya
 *    existe y puede tener stock.
 *  - `CREATE_FIELDS` agrega lo que solo es seguro al dar de alta, con el
 *    producto todavia en cero.
 *
 * El caso que obliga a separarlas es `standard_price`: escribir el costo
 * sobre un producto con stock dispara una revalorizacion contable en Odoo.
 * Al crear no hay stock, asi que no produce ningun asiento. Lo mismo vale
 * para `list_price`, que ademas quedo fuera de la edicion masiva por
 * prudencia comercial, y para `is_storable`, que ES el rastreo de inventario.
 *
 * `qty_available`, `inventory_quantity` y `free_qty` quedan fuera de AMBAS
 * por construccion: ponerle cantidad a un producto exige un ajuste de
 * inventario, y eso es exactamente lo que este modulo no puede hacer.
 *
 * Regla para mantenerlas: un campo entra en el MISMO cambio que introduce
 * quien lo escribe, nunca antes.
 */
export const UPDATE_FIELDS: ReadonlySet<string> = new Set([
  "categ_id",
  "is_published",
  "public_categ_ids",
  "supplier_taxes_id",
  "seller_ids",
]);

/** Solo seguros al dar de alta, con el producto en cero. */
const CREATE_ONLY_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "type",
  "is_storable",
  "list_price",
  "standard_price",
  "image_1920",
  "show_availability",
  // Si el producto sale en la caja del punto de venta. Es una bandera de
  // catalogo: no crea stock ni movimiento, solo decide donde se ve.
  "available_in_pos",
]);

export const CREATE_FIELDS: ReadonlySet<string> = new Set([
  ...UPDATE_FIELDS,
  ...CREATE_ONLY_FIELDS,
]);

export function assertWritableOnUpdate(values: Record<string, unknown>): void {
  assertEn(values, UPDATE_FIELDS, "actualizacion");
}

export function assertWritableOnCreate(values: Record<string, unknown>): void {
  assertEn(values, CREATE_FIELDS, "creacion");
}

function assertEn(
  values: Record<string, unknown>,
  permitidos: ReadonlySet<string>,
  operacion: string
): void {
  for (const campo of Object.keys(values)) {
    if (!permitidos.has(campo)) {
      throw new Error(`Campo no permitido en ${operacion} de catalogo: ${campo}`);
    }
  }
}

/** Escribir en cualquiera de estos genera movimiento de inventario. */
const FORBIDDEN_MODELS: ReadonlySet<string> = new Set([
  "stock.quant",
  "stock.move",
  "stock.inventory",
]);

export function assertModelAllowed(model: string): void {
  if (FORBIDDEN_MODELS.has(model)) {
    throw new Error(`Modelo prohibido: ${model} — este modulo no puede tocar inventario`);
  }
}

/**
 * Campos de una regla de reabastecimiento (`stock.warehouse.orderpoint`).
 *
 * Es el UNICO modelo del modulo `stock` en el que este codigo escribe, y hace
 * falta decir por que se permite cuando `stock.quant` y `stock.move` estan
 * prohibidos: una regla no mueve una sola unidad. Dice "cuando el stock baje
 * de X, repon hasta Y", y `qty_available` no cambia al crearla.
 *
 * Lo que si puede hacer es generar una orden de compra, pero solo con
 * `trigger: "auto"` y solo cuando corre el planificador de Odoo. Por eso las
 * reglas se crean SIEMPRE en `manual`: quedan como sugerencia en la pantalla
 * de reabastecimiento y no compran nada sin que alguien lo mire. Es ademas lo
 * que ya hace la tienda -- 1.468 de sus reglas son manuales.
 */
export const ORDERPOINT_FIELDS: ReadonlySet<string> = new Set([
  "product_id",
  "product_min_qty",
  "product_max_qty",
  "warehouse_id",
  "location_id",
  "trigger",
]);

export function assertWritableOnOrderpoint(values: Record<string, unknown>): void {
  assertEn(values, ORDERPOINT_FIELDS, "regla de reabastecimiento");
}

export interface OrderpointInput {
  /** Variante (`product.product`), NO la plantilla. */
  productVariantId: number;
  warehouseId: number;
  locationId: number;
  min: number;
  max: number;
}

export function toOdooOrderpointValues(input: OrderpointInput): Record<string, unknown> {
  return {
    product_id: input.productVariantId,
    warehouse_id: input.warehouseId,
    location_id: input.locationId,
    product_min_qty: input.min,
    product_max_qty: input.max,
    // Nunca "auto": ver el comentario de ORDERPOINT_FIELDS.
    trigger: "manual",
  };
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

/**
 * Traduce una fila de la hoja a los valores de creacion de Odoo.
 *
 * `qtyOnHand` NO aparece aqui y no debe aparecer nunca: se captura para
 * exportarla como pendiente y que el dueño la cargue en Odoo, porque
 * escribirla exigiria un ajuste de inventario.
 */
export function toOdooCreateValues(
  row: ProductCreateInput,
  imageBase64: string | null
): Record<string, unknown> {
  const v: Record<string, unknown> = {
    name: row.name.trim(),
    type: row.productType,
    // Odoo solo admite rastreo en bienes; la validacion ya lo garantiza,
    // pero aqui se fuerza para que un dato viejo no cree un servicio raro.
    is_storable: row.productType === "consu" ? row.isStorable : false,
    is_published: row.isPublished,
    show_availability: row.showAvailability,
    available_in_pos: row.availableInPos,
  };

  if (row.salePrice !== null) v.list_price = row.salePrice;
  if (row.cost !== null) v.standard_price = row.cost;
  if (row.categoryId !== null) v.categ_id = row.categoryId;
  if (row.purchaseTaxIds.length > 0) v.supplier_taxes_id = [[6, 0, row.purchaseTaxIds]];
  if (row.publicCategoryIds.length > 0) v.public_categ_ids = [[6, 0, row.publicCategoryIds]];
  // Comando 0: crear el product.supplierinfo junto con la plantilla.
  if (row.supplierPartnerId !== null) {
    v.seller_ids = [[0, 0, { partner_id: row.supplierPartnerId }]];
  }
  if (imageBase64) v.image_1920 = imageBase64;

  return v;
}
