"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadImageRepairs, type ImageRepairTarget } from "@/lib/products/image-repair-candidates";
import { repairImage, thumbnailDataUrl, LADO_PRODUCTO_SUFICIENTE } from "@/lib/products/image-repair";
import { IMAGE_REPAIR_LIMIT, IMAGE_REPAIR_MAX, IMAGE_REPAIR_PREVIEW_COUNT } from "@/lib/products/image-repair-limits";
import { writeTemplateImage, esRechazoDeNegocio } from "@/lib/products/odoo-catalog-write";
import { translateOdooError } from "@/lib/odoo-write";

/**
 * Reparacion de fotos de las fichas (recorte del margen blanco y cuadrado),
 * en dos pasos y los dos por clic del usuario:
 *
 *  1. `previewImageRepair`: muestra el antes y despues de las primeras 5.
 *  2. `writeImageRepairBatch`: vuelve a seleccionar en el servidor, respalda
 *     cada foto original en Postgres y solo entonces escribe la nueva.
 *
 * Nada de esto corre desde el sync ni desde un cron.
 */

const SETTING_ULTIMA_CORRIDA = "imagenes.ultimaCorrida";

export type ImageRepairPreviewItem = {
  templateId: number;
  name: string;
  tier: string | null;
  antes: string;
  despues: string;
  originalSize: string;
  side: number;
  /** Falso cuando el producto tiene menos de 500 px: mejora, pero pide foto nueva. */
  suficiente: boolean;
};

type PreviewResult =
  | { ok: true; preview: ImageRepairPreviewItem[] }
  | { ok: false; error: string };

type WriteResult =
  | {
      ok: true;
      written: number;
      failed: Array<{ templateId: number; name: string; error: string }>;
      sample: Array<{ templateId: number; name: string }>;
    }
  | { ok: false; error: string };

export type ImageRepairUltimaCorrida = { at: string; written: number; failed: number };

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("No autorizado");
  return session;
}

const limitSchema = z.number().int().min(1).max(IMAGE_REPAIR_MAX).default(IMAGE_REPAIR_LIMIT);

async function toPreview(t: ImageRepairTarget): Promise<ImageRepairPreviewItem> {
  const reparada = await repairImage(t.original);
  return {
    templateId: t.templateId,
    name: t.name,
    tier: t.tier,
    antes: await thumbnailDataUrl(t.original),
    despues: await thumbnailDataUrl(Buffer.from(reparada.base64, "base64")),
    originalSize: `${t.analysis.width}x${t.analysis.height}`,
    side: reparada.side,
    suficiente: t.analysis.ladoProducto >= LADO_PRODUCTO_SUFICIENTE,
  };
}

export async function previewImageRepair(): Promise<PreviewResult> {
  await requireSession();
  try {
    // Solo las primeras 5: juntar el lote completo exige leer cientos de
    // fotos de Odoo, y eso se hace una sola vez, al confirmar.
    const targets = await loadImageRepairs(IMAGE_REPAIR_PREVIEW_COUNT);
    return { ok: true, preview: await Promise.all(targets.map(toPreview)) };
  } catch (err) {
    console.error("[imagenes] fallo la previsualizacion:", err);
    return { ok: false, error: "No se pudieron leer las fotos. Revisa la conexion con Odoo." };
  }
}

export async function writeImageRepairBatch(input: { limit?: number }): Promise<WriteResult> {
  const session = await requireSession();
  const limit = limitSchema.safeParse(input?.limit ?? IMAGE_REPAIR_LIMIT);
  if (!limit.success) return { ok: false, error: `El tope debe estar entre 1 y ${IMAGE_REPAIR_MAX}` };

  try {
    // Se vuelve a seleccionar en el servidor: la regla mira la foto actual,
    // asi que una ficha que alguien cambio entre tanto ya no califica.
    const targets = await loadImageRepairs(limit.data);
    const fallidas: Array<{ templateId: number; name: string; error: string }> = [];
    let written = 0;

    const cortar = (desde: number, error: string) => {
      for (const resto of targets.slice(desde)) {
        fallidas.push({ templateId: resto.templateId, name: resto.name, error });
      }
    };

    for (let i = 0; i < targets.length; i += 1) {
      const t = targets[i];

      let reparada: Awaited<ReturnType<typeof repairImage>>;
      try {
        reparada = await repairImage(t.original);
      } catch (err) {
        console.error(`[imagenes] no se pudo procesar la foto de ${t.templateId}:`, err);
        fallidas.push({ templateId: t.templateId, name: t.name, error: "No se pudo procesar la foto" });
        continue;
      }

      // Respaldo primero. Si Postgres falla no se escribe nada mas: sin
      // respaldo no hay como volver a la foto original.
      try {
        await prisma.productImageBackup.create({
          data: {
            odooTemplateId: t.templateId,
            imageBase64: t.original.toString("base64"),
            repairedSide: reparada.side,
            createdBy: session.user?.email ?? null,
          },
        });
      } catch (err) {
        console.error("[imagenes] fallo el respaldo, se corta la corrida:", err);
        cortar(i, "No se pudo respaldar la foto original; no se escribio");
        break;
      }

      try {
        await writeTemplateImage(t.templateId, reparada.base64);
        written += 1;
      } catch (err) {
        const mensaje = translateOdooError(err, "catalogo");
        if (!esRechazoDeNegocio(err)) {
          // Odoo no respondio: seguir seria repetir el mismo timeout por cada
          // ficha que queda. Se marca lo que falta como fallido y se corta.
          cortar(i, mensaje);
          break;
        }
        fallidas.push({ templateId: t.templateId, name: t.name, error: mensaje });
      }
    }

    const registro: ImageRepairUltimaCorrida = { at: new Date().toISOString(), written, failed: fallidas.length };
    await prisma.setting.upsert({
      where: { key: SETTING_ULTIMA_CORRIDA },
      create: { key: SETTING_ULTIMA_CORRIDA, value: JSON.stringify(registro) },
      update: { value: JSON.stringify(registro) },
    });
    console.info(`[imagenes] corrida: ${written} fotos reparadas, ${fallidas.length} fallidas`);

    return {
      ok: true,
      written,
      failed: fallidas,
      sample: targets.slice(0, IMAGE_REPAIR_PREVIEW_COUNT).map((t) => ({ templateId: t.templateId, name: t.name })),
    };
  } catch (err) {
    console.error("[imagenes] fallo la corrida:", err);
    return { ok: false, error: "No se pudo completar la corrida. Revisa la conexion con Odoo." };
  }
}

/** Ultima corrida registrada, para mostrarla junto al boton. */
export async function getImageRepairUltimaCorrida(): Promise<ImageRepairUltimaCorrida | null> {
  await requireSession();
  const row = await prisma.setting.findUnique({ where: { key: SETTING_ULTIMA_CORRIDA } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as ImageRepairUltimaCorrida;
  } catch {
    return null;
  }
}
