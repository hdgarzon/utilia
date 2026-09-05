/** Tipos de producto en Odoo 19: Bienes / Servicio / Combo. */
export type ProductType = "consu" | "service" | "combo";

/** Filtros de "producto con problema" que el catalogo ofrece como atajo. */
export type CatalogProblem =
  | "sin_imagen"
  | "sin_categoria_web"
  | "sin_proveedor"
  | "sin_impuesto"
  | "sin_publicar";

export interface CatalogFilters {
  query?: string;
  categoryId?: number;
  publicCategoryId?: number;
  type?: ProductType;
  published?: boolean;
  problem?: CatalogProblem;
}

export interface CatalogRow {
  templateId: number;
  name: string;
  defaultCode: string | null;
  type: ProductType;
  isStorable: boolean;
  categoryId: number | null;
  categoryName: string | null;
  listPrice: number;
  /** Solo lectura. Utilia jamas escribe esta cifra. */
  qtyAvailable: number;
  isPublished: boolean;
  publicCategoryIds: number[];
  purchaseTaxIds: number[];
  supplierName: string | null;
  imageThumb: string | null;
}

export interface CatalogOptions {
  categories: Array<{ id: number; name: string }>;
  publicCategories: Array<{ id: number; name: string }>;
  purchaseTaxes: Array<{ id: number; name: string }>;
  suppliers: Array<{ id: number; name: string }>;
}

/**
 * Intencion de cambio en lenguaje de la app, no de Odoo. `toOdooValues` la
 * traduce. NO incluye costo: escribirlo sobre un producto con stock dispara
 * una revalorizacion contable (ver spec).
 */
export interface TemplatePatch {
  categoryId?: number;
  publicCategoryIds?: number[];
  isPublished?: boolean;
  purchaseTaxIds?: number[];
  /** REEMPLAZA los proveedores existentes del producto (decision del dueño). */
  supplierPartnerId?: number;
}

export interface BulkResult {
  ok: number[];
  failed: Array<{ id: number; error: string }>;
}
