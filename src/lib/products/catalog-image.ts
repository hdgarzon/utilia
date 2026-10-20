import sharp from "sharp";
import { odooRpc } from "@/lib/odoo";

/**
 * Imagen de un producto para el catalogo WhatsApp, en JPEG.
 *
 * Odoo expone `/web/image/product.template/<id>/image_1920` sin login, pero
 * siempre en WebP y, para los templates no publicados en la web, devuelve un
 * marcador de posicion. Meta solo acepta JPEG o PNG. Por eso la imagen se
 * trae de Odoo, se convierte y la sirve Utilia (ver ADR 0002).
 *
 * Primero se intenta la URL publica (barata, sin autenticar, sin consumir el
 * cupo de llamadas RPC). Si Odoo devuelve el marcador, se lee `image_1920`
 * por RPC, que si trae la imagen de los no publicados.
 */

export type CatalogImageKind = "template" | "variant";

const ODOO_MODEL: Record<CatalogImageKind, string> = {
  template: "product.template",
  variant: "product.product",
};

const JPEG_QUALITY = 85;
/** Lado maximo con el que se sirve. Meta pide al menos 500 px. */
const MAX_SIDE = 1280;

let placeholderPromise: Promise<Uint8Array | null> | null = null;

/** Marcador de posicion de Odoo: lo que devuelve para un id inexistente. */
function odooPlaceholder(base: string): Promise<Uint8Array | null> {
  placeholderPromise ??= fetch(`${base}/web/image/product.template/0/image_1920`)
    .then(async (res) => (res.ok ? new Uint8Array(await res.arrayBuffer()) : null))
    .catch(() => null);
  return placeholderPromise;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function fetchPublicImage(base: string, kind: CatalogImageKind, id: number): Promise<Uint8Array | null> {
  const res = await fetch(`${base}/web/image/${ODOO_MODEL[kind]}/${id}/image_1920`).catch(() => null);
  if (!res || !res.ok || !res.headers.get("content-type")?.startsWith("image/")) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const placeholder = await odooPlaceholder(base);
  if (placeholder && sameBytes(bytes, placeholder)) return null;
  return bytes;
}

async function fetchRpcImage(kind: CatalogImageKind, id: number): Promise<Uint8Array | null> {
  const rows = await odooRpc.searchRead<{ id: number; image_1920: string | false }>(
    ODOO_MODEL[kind],
    ["|", ["active", "=", true], ["active", "=", false], ["id", "=", id]],
    ["id", "image_1920"],
    { limit: 1 }
  );
  const img = rows[0]?.image_1920;
  return typeof img === "string" && img.length > 0 ? new Uint8Array(Buffer.from(img, "base64")) : null;
}

/** Devuelve la imagen original de Odoo (en el formato que la guarde) o null si no tiene. */
export async function fetchOdooImage(kind: CatalogImageKind, id: number): Promise<Uint8Array | null> {
  const base = process.env.ODOO_BASE_URL;
  if (base) {
    const publica = await fetchPublicImage(base, kind, id);
    if (publica) return publica;
  }
  return fetchRpcImage(kind, id);
}

/** Convierte a JPEG con fondo blanco (las transparencias no existen en JPEG). */
export async function toJpeg(image: Uint8Array): Promise<Buffer> {
  return sharp(image)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/** Imagen lista para Meta: JPEG, o null si el producto no tiene imagen. */
export async function getCatalogImageJpeg(kind: CatalogImageKind, id: number): Promise<Buffer | null> {
  const original = await fetchOdooImage(kind, id);
  return original ? toJpeg(original) : null;
}
