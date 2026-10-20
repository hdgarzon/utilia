import { prisma } from "@/lib/prisma";
import { getABCAnalysis, type ABCTier } from "@/lib/analytics/abc";

/**
 * Catalogo WhatsApp: exportacion del catalogo al formato CSV de Meta Commerce
 * Manager, que luego se conecta al numero de WhatsApp Business.
 *
 * La app de WhatsApp Business admite hasta 500 productos, por eso el tope.
 * Se exporta por template (no por variante) para no repetir el mismo producto
 * con cada color o numero, y se priorizan las clases A y B del ABC.
 *
 * Las imagenes salen por `/api/catalog/image/<templateId>` de Utilia y no por
 * la URL publica de Odoo: Odoo las sirve en WebP y Meta solo acepta JPEG o
 * PNG (ver ADR 0002).
 */

export const META_CATALOG_LIMIT = 500;
/** Dias sin venta a partir de los cuales un producto ya no entra al catalogo. */
export const META_CATALOG_SALE_DAYS = 30;

/** Columnas del CSV, en el orden que espera la plantilla de Meta. */
export const META_CATALOG_COLUMNS = [
  "id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "link",
  "image_link",
  "brand",
  "product_type",
  "google_product_category",
  "custom_label_0",
] as const;

export type MetaCatalogColumn = (typeof META_CATALOG_COLUMNS)[number];
export type MetaCatalogRow = Record<MetaCatalogColumn, string>;

/** Lo que la seleccion necesita de cada variante de ProductInsight. */
export interface CatalogInsight {
  odooProductId: number;
  odooTemplateId: number | null;
  templateName: string | null;
  name: string;
  category: string | null;
  stockQty: number;
  salePrice: number;
  avgDailySales30d: number;
  rotationDays: number;
}

/** Un producto del catalogo: un template con sus variantes consolidadas. */
export interface CatalogProduct {
  /** Id de product.template, o null si la variante no tiene template conocido. */
  templateId: number | null;
  /** Variante representativa (la de mayor venta). */
  odooProductId: number;
  name: string;
  category: string | null;
  stockQty: number;
  salePrice: number;
  avgDailySales30d: number;
  rotationDays: number;
  tier: ABCTier | null;
}

export interface MetaCatalogOptions {
  /** Origen publico de Utilia, sin barra final. Da la `image_link`. */
  publicBaseUrl: string;
  /** URL base de Odoo, sin barra final. Da el `link` a la tienda web. */
  odooBaseUrl: string;
  /** Marca que va en la columna `brand`. Vacia si no se configura. */
  brand?: string;
}

/**
 * Categoria de Google Shopping por coleccion. Meta la usa para clasificar el
 * catalogo; es opcional, asi que las categorias que no esten aqui van vacias.
 */
const GOOGLE_CATEGORY_BY_COLLECTION: Record<string, string> = {
  Papeleria: "Office Supplies",
  Piñateria: "Arts & Entertainment > Party & Celebration > Party Supplies",
  Cacharreria: "Home & Garden",
  Cosmeticos: "Health & Beauty > Personal Care > Cosmetics",
  "Cuidado personal": "Health & Beauty > Personal Care",
  Jugueteria: "Toys & Games",
  Confiteria: "Food, Beverages & Tobacco > Food Items > Candy & Chocolate",
  Tecnologia: "Electronics",
  "Joyeria y accesorios": "Apparel & Accessories > Jewelry",
};

const TIER_ORDER: Record<ABCTier, number> = { A: 0, B: 1, C: 2 };
const SIN_CLASE = 3;

/** Clave que agrupa variantes: el template, o la variante si no tiene. */
export function templateKey(p: { odooTemplateId: number | null; odooProductId: number }): string {
  return p.odooTemplateId !== null ? `t_${p.odooTemplateId}` : `p_${p.odooProductId}`;
}

/**
 * Consolida las variantes de un template en un producto: stock sumado, venta
 * sumada, dias sin venta de la variante mas reciente y precio de la variante
 * que mas vende (la que el cliente va a pedir).
 */
export function groupByTemplate(insights: CatalogInsight[]): CatalogProduct[] {
  const groups = new Map<string, CatalogInsight[]>();
  for (const p of insights) {
    const key = templateKey(p);
    const g = groups.get(key) ?? [];
    g.push(p);
    groups.set(key, g);
  }
  return Array.from(groups.values()).map((variants) => {
    const rep = variants.reduce((best, v) => (v.avgDailySales30d > best.avgDailySales30d ? v : best), variants[0]);
    return {
      templateId: rep.odooTemplateId,
      odooProductId: rep.odooProductId,
      name: rep.templateName ?? rep.name,
      category: rep.category,
      stockQty: variants.reduce((s, v) => s + v.stockQty, 0),
      salePrice: rep.salePrice,
      avgDailySales30d: variants.reduce((s, v) => s + v.avgDailySales30d, 0),
      rotationDays: Math.min(...variants.map((v) => v.rotationDays)),
      tier: null,
    };
  });
}

/**
 * Elige los productos que van al catalogo: con stock, con venta en los
 * ultimos `META_CATALOG_SALE_DAYS` dias y con precio. Ordena por clase ABC
 * (A, B, C, sin clase) y dentro de cada clase por venta diaria, y corta en
 * `limit`.
 *
 * `tierOf` viene de `getABCAnalysis`, que clasifica por template y solo
 * incluye lo vendido en los ultimos 7 dias: lo que vendio en el mes pero no
 * esta semana queda "sin clase" y entra de ultimo.
 */
export function selectMetaCatalogProducts(
  insights: CatalogInsight[],
  tierOf: Map<number, ABCTier>,
  limit: number = META_CATALOG_LIMIT
): CatalogProduct[] {
  return groupByTemplate(insights)
    .map((p) => ({ ...p, tier: tierOf.get(p.templateId ?? p.odooProductId) ?? null }))
    .filter((p) => p.stockQty > 0 && p.rotationDays <= META_CATALOG_SALE_DAYS && p.salePrice > 0)
    .sort((a, b) => {
      const ta = a.tier ? TIER_ORDER[a.tier] : SIN_CLASE;
      const tb = b.tier ? TIER_ORDER[b.tier] : SIN_CLASE;
      if (ta !== tb) return ta - tb;
      if (b.avgDailySales30d !== a.avgDailySales30d) return b.avgDailySales30d - a.avgDailySales30d;
      return a.name.localeCompare(b.name, "es");
    })
    .slice(0, limit);
}

/** Precio en pesos sin decimales, en el formato `8800 COP` que Meta acepta. */
export function formatMetaPrice(price: number): string {
  return `${Math.round(price)} COP`;
}

/**
 * Nombre de coleccion a partir de la categoria de Odoo: "PAPELERÍA" pasa a
 * "Papeleria", "JOYERÍA Y ACCESORIOS" a "Joyeria y accesorios". Se quitan
 * tildes pero se conserva la eñe. Sin categoria, "Otros".
 */
export function toCollectionName(category: string | null): string {
  if (!category) return "Otros";
  // Odoo puede traer la ruta completa ("All / Deliveries"): se usa la hoja.
  const leaf = category.split("/").pop()?.trim() ?? "";
  if (!leaf || leaf.toLowerCase() === "all") return "Otros";
  const sinTildes = leaf
    .normalize("NFD")
    .replace(/̃/g, "\u0000") // protege la virgulilla de la eñe
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0000/g, "̃")
    .normalize("NFC");
  const lower = sinTildes.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function metaCatalogId(p: Pick<CatalogProduct, "templateId" | "odooProductId">): string {
  return p.templateId !== null ? `tmpl-${p.templateId}` : `prod-${p.odooProductId}`;
}

/** URL publica de la imagen de un template, servida por Utilia en JPEG. */
export function metaImageLink(publicBaseUrl: string, p: Pick<CatalogProduct, "templateId" | "odooProductId">): string {
  const id = p.templateId ?? p.odooProductId;
  const kind = p.templateId !== null ? "template" : "variant";
  return `${publicBaseUrl}/api/catalog/image/${id}?kind=${kind}`;
}

const TITLE_MAX = 200;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildMetaCatalogRow(p: CatalogProduct, opts: MetaCatalogOptions): MetaCatalogRow {
  const title = clean(p.name).slice(0, TITLE_MAX);
  const collection = toCollectionName(p.category);
  return {
    id: metaCatalogId(p),
    title,
    description: `${title}. ${collection}. Disponible en tienda, escríbenos por WhatsApp para pedirlo.`,
    availability: "in stock",
    condition: "new",
    price: formatMetaPrice(p.salePrice),
    link: p.templateId !== null ? `${opts.odooBaseUrl}/shop/${p.templateId}` : `${opts.odooBaseUrl}/shop`,
    image_link: metaImageLink(opts.publicBaseUrl, p),
    brand: opts.brand ?? "",
    product_type: collection,
    google_product_category: GOOGLE_CATEGORY_BY_COLLECTION[collection] ?? "",
    custom_label_0: collection,
  };
}

export function buildMetaCatalogRows(products: CatalogProduct[], opts: MetaCatalogOptions): MetaCatalogRow[] {
  return products.map((p) => buildMetaCatalogRow(p, opts));
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV con cabecera, separado por comas, filas terminadas en \r\n (RFC 4180). */
export function toMetaCatalogCsv(rows: MetaCatalogRow[]): string {
  const lines = [META_CATALOG_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(META_CATALOG_COLUMNS.map((c) => csvCell(row[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export interface MetaCatalogExport {
  csv: string;
  rows: number;
  byTier: Record<ABCTier | "sin_clase", number>;
}

/** Lee ProductInsight y el ABC, selecciona y arma el CSV. Solo lectura. */
export async function buildMetaCatalogExport(opts: MetaCatalogOptions): Promise<MetaCatalogExport> {
  const [insights, abc] = await Promise.all([
    prisma.productInsight.findMany({
      where: { stockQty: { gt: 0 }, rotationDays: { lte: META_CATALOG_SALE_DAYS }, salePrice: { gt: 0 } },
      select: {
        odooProductId: true,
        odooTemplateId: true,
        templateName: true,
        name: true,
        category: true,
        stockQty: true,
        salePrice: true,
        avgDailySales30d: true,
        rotationDays: true,
      },
    }),
    getABCAnalysis(),
  ]);
  // El ABC agrupa por template y expone el id del template en odooProductId.
  const tierOf = new Map<number, ABCTier>(abc.products.map((p) => [p.odooProductId, p.tier]));
  const selected = selectMetaCatalogProducts(insights, tierOf);
  const byTier: MetaCatalogExport["byTier"] = { A: 0, B: 0, C: 0, sin_clase: 0 };
  for (const p of selected) byTier[p.tier ?? "sin_clase"] += 1;
  return { csv: toMetaCatalogCsv(buildMetaCatalogRows(selected, opts)), rows: selected.length, byTier };
}
