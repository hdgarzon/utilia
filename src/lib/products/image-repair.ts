import sharp from "sharp";

/**
 * Reparacion de la foto principal de una ficha: recorta el margen blanco y
 * centra el producto en un cuadrado blanco. Solo servidor (sharp).
 *
 * Por que solo esto: la auditoria de las 1.243 fichas publicadas mostro que
 * el peso no es problema (Odoo ya sirve WebP de ~25 KB) y que lo que mas se
 * nota en la tienda es el producto chiquito en medio de un lienzo blanco o
 * apaisado. Sobre fondo gris o de ambiente el recorte deja un recuadro de
 * otro color pegado sobre blanco y se ve peor, por eso esas no se tocan.
 *
 * Nunca se agranda la foto: el lienzo sale del tamaño real del producto. Una
 * foto pequeña queda mejor encuadrada pero sigue pequeña; esa necesita foto
 * nueva, no un reescalado que invente pixeles.
 */

/** Borde que cuenta como blanco: los tres canales por encima de esto. */
const BLANCO = 235;
/** Fraccion minima del borde que debe ser blanca para recortar sin riesgo. */
export const BORDE_BLANCO_MIN = 0.9;
/** Por debajo de esto el producto se ve chico en el cuadro. */
export const OCUPACION_MAX = 0.8;
/** Proporcion que todavia cuenta como cuadrada. */
const CUADRADA_MIN = 0.9;
const CUADRADA_MAX = 1.1;
/** Lado del producto sobre el lado del lienzo tras reparar (6 % de margen por lado). */
export const OCUPACION_OBJETIVO = 0.88;
/** Tolerancia del recorte: diferencia con el blanco que se considera fondo. */
const UMBRAL_RECORTE = 12;
/** Mismo tope al que Odoo reduce image_1920. */
const LADO_MAX = 1920;
/** Lado minimo del producto para que la foto se vea bien sin reemplazarla. */
export const LADO_PRODUCTO_SUFICIENTE = 500;
const CALIDAD_JPEG = 85;

export interface ImageAnalysis {
  width: number;
  height: number;
  /** Fraccion de la franja exterior (3 px a 48x48) que es blanca. */
  bordeBlanco: number;
  /** Lado mayor del producto, en pixeles, sin el margen blanco. */
  ladoProducto: number;
  /** ladoProducto sobre el lado mayor del lienzo. */
  ocupacion: number;
}

export async function analyzeImage(buf: Buffer): Promise<ImageAnalysis> {
  const meta = await sharp(buf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const { data, info } = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .resize(48, 48, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let borde = 0;
  let blancos = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (x > 2 && y > 2 && x < info.width - 3 && y < info.height - 3) continue;
      const i = (y * info.width + x) * info.channels;
      borde++;
      if (data[i] > BLANCO && data[i + 1] > BLANCO && data[i + 2] > BLANCO) blancos++;
    }
  }

  const recorte = await recortarBlanco(buf).catch(() => null);
  const ladoProducto = recorte ? Math.max(recorte.info.width, recorte.info.height) : Math.max(width, height);
  return {
    width,
    height,
    bordeBlanco: blancos / borde,
    ladoProducto,
    ocupacion: ladoProducto / Math.max(width, height, 1),
  };
}

/**
 * Si conviene reparar: fondo blanco (para que el recorte sea limpio) y, o el
 * producto ocupa poco del cuadro, o la foto no es cuadrada.
 *
 * Una foto ya reparada sale cuadrada y con el producto al 88 %, asi que no
 * vuelve a calificar: correr la accion dos veces no la toca de nuevo.
 */
export function needsRepair(a: ImageAnalysis): boolean {
  if (a.width === 0 || a.height === 0) return false;
  if (a.bordeBlanco < BORDE_BLANCO_MIN) return false;
  const proporcion = a.width / a.height;
  const noCuadrada = proporcion < CUADRADA_MIN || proporcion > CUADRADA_MAX;
  return a.ocupacion < OCUPACION_MAX || noCuadrada;
}

/** Lado del lienzo cuadrado que deja al producto en OCUPACION_OBJETIVO, sin agrandarlo. */
export function repairedSide(ladoProducto: number): number {
  return Math.min(LADO_MAX, Math.max(1, Math.round(ladoProducto / OCUPACION_OBJETIVO)));
}

export interface RepairedImage {
  /** JPEG en base64 sin prefijo `data:`, lo que Odoo espera en image_1920. */
  base64: string;
  side: number;
}

export async function repairImage(buf: Buffer): Promise<RepairedImage> {
  const recorte = await recortarBlanco(buf);
  const side = repairedSide(Math.max(recorte.info.width, recorte.info.height));
  const interior = Math.max(1, Math.round(side * OCUPACION_OBJETIVO));
  const producto = await sharp(recorte.data)
    .resize(interior, interior, { fit: "inside", withoutEnlargement: true })
    .toBuffer();
  const out = await sharp({
    create: { width: side, height: side, channels: 3, background: "#ffffff" },
  })
    .composite([{ input: producto, gravity: "center" }])
    .jpeg({ quality: CALIDAD_JPEG, mozjpeg: true })
    .toBuffer();
  return { base64: out.toString("base64"), side };
}

/** Miniatura JPEG para la vista previa, como data URL. */
export async function thumbnailDataUrl(buf: Buffer, side = 240): Promise<string> {
  const out = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .resize(side, side, { fit: "contain", background: "#ffffff" })
    .jpeg({ quality: 75 })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

/**
 * Dos pasadas a proposito: sharp aplica `trim` antes que `flatten` dentro de
 * un mismo pipeline, y una foto con transparencia se recortaria contra su
 * negro transparente en vez de contra el blanco.
 */
async function recortarBlanco(buf: Buffer) {
  const plana = await sharp(buf).flatten({ background: "#ffffff" }).png().toBuffer();
  return sharp(plana)
    .trim({ background: "#ffffff", threshold: UMBRAL_RECORTE })
    .png()
    .toBuffer({ resolveWithObject: true });
}
