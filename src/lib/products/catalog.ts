import { odooRpc } from "@/lib/odoo";
import { buildCatalogDomain } from "./domain";
import type { CatalogFilters, CatalogOptions, CatalogRow, ProductType } from "./types";

export const PAGE_SIZE = 50;

/** Campos que el listado pide a Odoo. Solo lectura. */
const CATALOG_FIELDS = [
  "id",
  "name",
  "default_code",
  "type",
  "is_storable",
  "categ_id",
  "list_price",
  "qty_available",
  "is_published",
  "public_categ_ids",
  "supplier_taxes_id",
  "image_128",
];

interface RawTemplate {
  id: number;
  name: string;
  default_code: string | false;
  type: ProductType;
  is_storable: boolean;
  categ_id: [number, string] | false;
  list_price: number;
  qty_available: number;
  is_published: boolean;
  public_categ_ids: number[];
  supplier_taxes_id: number[];
  image_128: string | false;
}

/**
 * Lee una pagina del catalogo directo de Odoo.
 *
 * Se lee en vivo y no de una tabla espejo por dos razones: todo lo editable
 * vive en product.template (ProductInsight es a nivel de variante y no guarda
 * imagen, tipo, impuesto ni proveedor), y despues de un cambio masivo la tabla
 * tiene que mostrar la verdad de inmediato, no la del ultimo sync.
 */
export async function listTemplates(
  filters: CatalogFilters,
  page: number
): Promise<{ rows: CatalogRow[]; total: number }> {
  const domain = buildCatalogDomain(filters);
  const offset = Math.max(0, page - 1) * PAGE_SIZE;

  const [raw, total] = await Promise.all([
    odooRpc.searchRead<RawTemplate>("product.template", domain, CATALOG_FIELDS, {
      limit: PAGE_SIZE,
      offset,
      order: "name asc",
    }),
    odooRpc.executeKw<number>("product.template", "search_count", [domain]),
  ]);

  const templateIds = raw.map((t) => t.id);

  // El nombre del proveedor no viene en product.template: seller_ids apunta a
  // product.supplierinfo. Una consulta extra por pagina, no por producto.
  const supplierByTemplate = await getSupplierNames(templateIds);

  const rows = raw.map((t): CatalogRow => {
    return {
      templateId: t.id,
      name: t.name,
      defaultCode: t.default_code || null,
      type: t.type,
      isStorable: t.is_storable,
      categoryId: t.categ_id ? t.categ_id[0] : null,
      categoryName: t.categ_id ? t.categ_id[1] : null,
      listPrice: t.list_price,
      qtyAvailable: t.qty_available,
      isPublished: t.is_published,
      publicCategoryIds: t.public_categ_ids ?? [],
      purchaseTaxIds: t.supplier_taxes_id ?? [],
      supplierName: supplierByTemplate.get(t.id) ?? null,
      imageThumb: t.image_128 ? `data:image/png;base64,${t.image_128}` : null,
    };
  });

  return { rows, total };
}

/** Primer proveedor de cada plantilla, por orden de prioridad de Odoo. */
async function getSupplierNames(templateIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (templateIds.length === 0) return out;

  const infos = await odooRpc.searchRead<{
    product_tmpl_id: [number, string] | false;
    partner_id: [number, string] | false;
  }>(
    "product.supplierinfo",
    [["product_tmpl_id", "in", templateIds]],
    ["product_tmpl_id", "partner_id"],
    { limit: 1000, order: "sequence asc, id asc" }
  );

  for (const info of infos) {
    if (!info.product_tmpl_id || !info.partner_id) continue;
    const tmplId = info.product_tmpl_id[0];
    if (!out.has(tmplId)) out.set(tmplId, info.partner_id[1]);
  }
  return out;
}

/**
 * Catalogos de referencia para filtros y dialogos. Se piden en paralelo; son
 * listas cortas (24 categorias, 14 web, decenas de impuestos, 24 proveedores).
 * Las cifras se mueven con el catalogo real: son para dimensionar, no un
 * valor esperado de prueba.
 */
export async function getCatalogOptions(): Promise<CatalogOptions> {
  const [categories, publicCategories, purchaseTaxes, suppliers] = await Promise.all([
    odooRpc.searchRead<{ id: number; complete_name: string }>(
      "product.category",
      [],
      ["id", "complete_name"],
      { limit: 200, order: "complete_name asc" }
    ),
    odooRpc.searchRead<{ id: number; name: string }>(
      "product.public.category",
      [],
      ["id", "name"],
      { limit: 200, order: "name asc" }
    ),
    odooRpc.searchRead<{ id: number; name: string }>(
      "account.tax",
      [["type_tax_use", "=", "purchase"]],
      ["id", "name"],
      { limit: 200, order: "name asc" }
    ),
    odooRpc.searchRead<{ id: number; name: string }>(
      "res.partner",
      [["supplier_rank", ">", 0]],
      ["id", "name"],
      { limit: 500, order: "name asc" }
    ),
  ]);

  return {
    categories: categories.map((c) => ({ id: c.id, name: c.complete_name })),
    publicCategories,
    purchaseTaxes,
    suppliers,
  };
}
