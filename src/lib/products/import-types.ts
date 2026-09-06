import type { ProductType } from "./types";

/** Una fila tal como la edita el usuario en la hoja, antes de validar. */
export interface ImportRowInput {
  /**
   * Identidad estable de la fila mientras se edita. Existe solo para la key
   * de React: usar el indice rompe el estado interno de las celdas (la de
   * imagen tiene el suyo) en cuanto se borra una fila del medio.
   */
  clientId: string;
  rowIndex: number;
  name: string;
  productType: ProductType;
  isStorable: boolean;
  /** Se captura y se exporta como pendiente; nunca se escribe en Odoo. */
  qtyOnHand: number | null;
  salePrice: number | null;
  cost: number | null;
  purchaseTaxIds: number[];
  categoryId: number | null;
  imageUrl: string | null;
  imageData: string | null;
  isPublished: boolean;
  publicCategoryIds: number[];
  showAvailability: boolean;
  supplierPartnerId: number | null;
}

/**
 * Lo que necesita la creacion en Odoo: la fila sin nada del navegador.
 * `clientId` solo sirve para la key de React y `rowIndex` para el orden en la
 * hoja; ninguno significa nada para Odoo.
 */
export type ProductCreateInput = Omit<ImportRowInput, "clientId" | "rowIndex">;

/** Una fila guardada, con su resultado. */
export interface ImportRowDraft extends ImportRowInput {
  /** Id en Postgres. Distinto de `clientId`, que solo vive en el navegador. */
  id: string;
  status: "PENDING" | "OK" | "ERROR";
  odooTemplateId: number | null;
  error: string | null;
  warning: string | null;
}

/**
 * Un problema en UNA celda. La hoja los agrupa por `field` para pintar de
 * rojo la celda exacta en vez de la fila entera.
 */
export interface CellError {
  field: keyof ImportRowInput;
  message: string;
  /** Una advertencia no impide crear; un error si. */
  level: "error" | "warning";
}

/** Lo que devuelve cada tanda de creacion, para mover la barra de progreso. */
export interface ImportProgress {
  processed: number;
  okCount: number;
  errorCount: number;
  remaining: number;
  done: boolean;
}

/**
 * Constructor de una fila en blanco.
 *
 * Vive aqui y no en `ImportSheet` porque `ImportToolbar` tambien la necesita:
 * si la exportara el componente, los dos se importarian mutuamente.
 */
export function filaVacia(rowIndex: number): ImportRowInput {
  return {
    // Identidad estable para la key de React. No viaja al servidor: el schema
    // de Zod de `saveBatch` no lo declara y Zod descarta lo que no conoce.
    clientId: crypto.randomUUID(),
    rowIndex,
    name: "",
    productType: "consu",
    isStorable: true,
    qtyOnHand: null,
    salePrice: null,
    cost: null,
    purchaseTaxIds: [],
    categoryId: null,
    imageUrl: null,
    imageData: null,
    isPublished: false,
    publicCategoryIds: [],
    showAvailability: false,
    supplierPartnerId: null,
  };
}

/** Topes duros, citados por la UI y por las server actions. */
export const MAX_ROWS_PER_BATCH = 200;
/** Base64 de la imagen ya reducida. ~500 KB. */
export const MAX_IMAGE_BASE64_BYTES = 500_000;
/** Filas que crea cada invocacion, para no pasarse del limite serverless. */
export const CREATE_SLICE_SIZE = 20;
