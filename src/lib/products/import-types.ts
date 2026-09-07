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

/**
 * Estado de una fila. Espeja el enum `ProductImportRowStatus` de Prisma.
 *
 * `CREATING` significa "se llamo a Odoo y no se pudo confirmar el resultado
 * aqui": el producto PUEDE existir alla. Es un estado terminal para el
 * programa -- solo sale de el una persona, mirando Odoo.
 */
export type ImportRowStatus = "PENDING" | "CREATING" | "OK" | "ERROR";

/**
 * Estados que toca cada consulta del servidor. Viven juntos y con nombre
 * porque el invariante que sostienen no se ve leyendo ninguna de ellas por
 * separado: `CREATING` no puede aparecer en NINGUNO. Una fila en CREATING que
 * se cuele en cualquiera de estas listas se vuelve a mandar a `createTemplate`
 * y crea el producto por segunda vez en Odoo.
 */
/** Lo unico que toma una tanda de creacion. */
export const ESTADO_POR_INTENTAR = "PENDING" as const;
/** Lo unico que "Reintentar" devuelve a PENDING. */
export const ESTADOS_REENCOLABLES = ["ERROR"] as const;
/** Lo unico que `saveBatch` puede borrar al reemplazar el borrador. */
export const ESTADOS_BORRABLES = ["PENDING", "ERROR"] as const;

/** Una fila guardada, con su resultado. */
export interface ImportRowDraft extends ImportRowInput {
  /** Id en Postgres. Distinto de `clientId`, que solo vive en el navegador. */
  id: string;
  status: ImportRowStatus;
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
  /**
   * Filas en CREATING: se llamo a Odoo y no se pudo confirmar aqui. No se
   * reintentan solas. Mientras haya una, el lote no esta terminado por mas
   * que `remaining` sea 0 -- por eso viaja aparte y no sumada a los errores.
   */
  unconfirmedCount: number;
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

/**
 * Fotos adjuntas al tope que se garantiza que caben en un lote. Ocho es un
 * numero realista: las fotos solo entran por carga manual desde el
 * computador -- el CSV trae un link, que se descarga en el servidor y nunca
 * pasa por el body -- asi que aunque la hoja tenga 200 filas de texto es raro
 * que mas de un puñado traiga foto pegada a mano.
 */
export const MAX_IMAGENES_ADJUNTAS = 8;

/** Lo que pueden pesar las fotos de un lote. */
export const MAX_IMAGE_PAYLOAD_BYTES = MAX_IMAGENES_ADJUNTAS * MAX_IMAGE_BASE64_BYTES;

/** Espacio para las filas de texto y el JSON que las envuelve. */
const MARGEN_TEXTO_BYTES = 400_000;

/**
 * Tope del body de una server action. Lo lee next.config.ts: el numero vive
 * aqui, junto a los otros topes, para que no haya dos verdades.
 *
 * Se deriva de los dos de arriba en vez de escribirse a mano. Escrito a mano
 * eran 4.000.000, que es exactamente ocho fotos al tope y NADA para el texto:
 * el comentario decia que dejaba margen para las 200 filas y no dejaba
 * ninguno. Sumando el margen explicito la cuenta no puede volver a mentir.
 *
 * Queda bajo el techo duro de 4,5 MB que Vercel impone a nivel de plataforma
 * para funciones serverless -- ese no se puede subir desde configuracion.
 */
export const MAX_ACTION_BODY_BYTES = MAX_IMAGE_PAYLOAD_BYTES + MARGEN_TEXTO_BYTES;

/**
 * Revisa que las fotos adjuntas quepan en una llamada a `saveBatch`.
 * Devuelve el mensaje a mostrar, o null si caben.
 *
 * Tiene que correr en el navegador, ANTES de enviar. Cuando el body se pasa,
 * la llamada la corta la plataforma antes de llegar al servidor: la accion
 * nunca se ejecuta, asi que no hay donde validarlo alla, y lo unico que ve el
 * navegador es un fallo de red. El usuario leia "revisa tu conexion" y no
 * tenia como saber que el problema eran las fotos.
 *
 * `bodySizeLimit` estaba calculado suponiendo ocho fotos por lote. Era una
 * estimacion de uso, no un tope: nada impedia adjuntarle foto a las 200
 * filas, y ahi el envio se va a 100 MB.
 */
export function revisarPesoImagenes(rows: Array<{ imageData: string | null }>): string | null {
  const conFoto = rows.filter((r) => r.imageData);
  const peso = conFoto.reduce((total, r) => total + (r.imageData?.length ?? 0), 0);
  if (peso <= MAX_IMAGE_PAYLOAD_BYTES) return null;

  const caben = Math.floor(MAX_IMAGE_PAYLOAD_BYTES / MAX_IMAGE_BASE64_BYTES);
  return (
    `Las ${conFoto.length} fotos adjuntas pesan ${Math.round(peso / 1000)} KB y el máximo por lote ` +
    `es ${Math.round(MAX_IMAGE_PAYLOAD_BYTES / 1000)} KB. Quita algunas o divide la lista en tandas ` +
    `de ~${caben} productos con foto. Las imágenes por link no cuentan: esas se descargan en el servidor.`
  );
}
