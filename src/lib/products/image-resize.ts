import { MAX_IMAGE_BASE64_BYTES } from "./import-types";

/** Mismo tope al que Odoo reduce image_1920. */
const MAX_LADO = 1920;
const CALIDAD_JPEG = 0.85;

/**
 * Reduce una imagen en el navegador y devuelve su base64 SIN el prefijo
 * `data:` (que es lo que Odoo espera en image_1920).
 *
 * Se reduce antes de subir, no en el servidor, por dos razones: el borrador
 * guarda el base64 en Postgres y una foto de celular sin reducir lo llenaria,
 * y subir 4 MB por fila para que el servidor los tire es desperdicio.
 */
export async function resizeImageToBase64(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Ese archivo no es una imagen");
  }

  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no pudo procesar la imagen");
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", CALIDAD_JPEG);
  const base64 = dataUrl.split(",")[1] ?? "";

  if (base64.length > MAX_IMAGE_BASE64_BYTES) {
    throw new Error(
      `La imagen sigue pesando demasiado tras reducirla (${Math.round(base64.length / 1000)} KB). Usa una más liviana.`
    );
  }
  return base64;
}
