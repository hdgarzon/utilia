import type { CellError, ImportRowInput } from "./import-types";
import type { CatalogOptions, ProductType } from "./types";

const TIPOS_VALIDOS: ReadonlySet<string> = new Set<ProductType>(["consu", "service", "combo"]);

/**
 * Valida una fila contra los catalogos vivos de Odoo y devuelve un problema
 * POR CELDA, no por fila: la hoja necesita saber que celda pintar de rojo.
 *
 * Sin imports de I/O a proposito. Recibe `options` ya cargado para poder
 * probarse sin Odoo.
 */
export function validateRow(row: ImportRowInput, options: CatalogOptions): CellError[] {
  const errores: CellError[] = [];
  const error = (field: CellError["field"], message: string) =>
    errores.push({ field, message, level: "error" });
  const aviso = (field: CellError["field"], message: string) =>
    errores.push({ field, message, level: "warning" });

  if (!row.name.trim()) error("name", "El nombre es obligatorio");

  if (!TIPOS_VALIDOS.has(row.productType)) {
    error("productType", "Tipo inválido: usa Bienes, Servicio o Combo");
  }

  // Odoo solo admite rastreo de inventario en bienes.
  const esBien = row.productType === "consu";
  if (!esBien && row.isStorable) {
    error("isStorable", "Solo los productos de tipo Bienes pueden llevar rastreo de inventario");
  }
  if (!esBien && row.qtyOnHand !== null) {
    error("qtyOnHand", "Un servicio o combo no lleva cantidad a la mano");
  }

  if (row.salePrice !== null && row.salePrice < 0) error("salePrice", "El precio no puede ser negativo");
  if (row.cost !== null && row.cost < 0) error("cost", "El costo no puede ser negativo");
  if (row.qtyOnHand !== null && row.qtyOnHand < 0) {
    error("qtyOnHand", "La cantidad no puede ser negativa");
  }

  if (row.categoryId !== null && !existe(options.categories, row.categoryId)) {
    error("categoryId", "Esa categoría no existe en el catálogo de Odoo");
  }
  for (const id of row.purchaseTaxIds) {
    if (!existe(options.purchaseTaxes, id)) {
      error("purchaseTaxIds", "Uno de los impuestos de compra no existe en el catálogo de Odoo");
      break;
    }
  }
  for (const id of row.publicCategoryIds) {
    if (!existe(options.publicCategories, id)) {
      error("publicCategoryIds", "Una de las categorías de la tienda no existe en el catálogo de Odoo");
      break;
    }
  }
  if (row.supplierPartnerId !== null && !existe(options.suppliers, row.supplierPartnerId)) {
    error("supplierPartnerId", "Ese proveedor no existe en el catálogo de Odoo");
  }

  if (row.imageUrl !== null && row.imageUrl.trim() && !esHttpUrl(row.imageUrl)) {
    error("imageUrl", "El link de la imagen debe empezar por http:// o https://");
  }

  // Advertencia y no error: el producto se publica igual, solo que no
  // aparecera bajo ninguna categoria de la tienda.
  if (row.isPublished && row.publicCategoryIds.length === 0) {
    aviso("publicCategoryIds", "Se publicará sin categoría en la tienda");
  }

  return errores;
}

/** Las advertencias no impiden crear; los errores si. */
export function rowIsCreatable(errors: CellError[]): boolean {
  return !errors.some((e) => e.level === "error");
}

function existe(lista: Array<{ id: number }>, id: number): boolean {
  return lista.some((o) => o.id === id);
}

function esHttpUrl(valor: string): boolean {
  try {
    const u = new URL(valor.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
