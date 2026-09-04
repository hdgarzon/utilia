import type { CatalogFilters } from "./types";

/**
 * Traduce los filtros de la UI a un dominio de Odoo.
 *
 * Los dominios de Odoo son notacion prefija: ["|", A, B, C] es (A OR B) AND C.
 * Los terminos sin operador se unen con AND implicito, por eso el bloque de
 * busqueda puede ir primero y el resto acumularse detras.
 */
export function buildCatalogDomain(f: CatalogFilters): unknown[] {
  const domain: unknown[] = [];

  const q = f.query?.trim();
  if (q) {
    domain.push("|", ["name", "ilike", q], ["default_code", "ilike", q]);
  }

  if (f.categoryId !== undefined) domain.push(["categ_id", "=", f.categoryId]);
  if (f.publicCategoryId !== undefined) domain.push(["public_categ_ids", "in", [f.publicCategoryId]]);
  if (f.type !== undefined) domain.push(["type", "=", f.type]);
  if (f.published !== undefined) domain.push(["is_published", "=", f.published]);

  switch (f.problem) {
    case "sin_imagen":
      domain.push(["image_1920", "=", false]);
      break;
    case "sin_categoria_web":
      domain.push(["public_categ_ids", "=", false]);
      break;
    case "sin_proveedor":
      domain.push(["seller_ids", "=", false]);
      break;
    case "sin_impuesto":
      domain.push(["supplier_taxes_id", "=", false]);
      break;
    case "sin_publicar":
      domain.push(["is_published", "=", false]);
      break;
  }

  return domain;
}
