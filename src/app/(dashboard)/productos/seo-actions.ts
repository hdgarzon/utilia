"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  loadSeoCandidates,
  SEO_BATCH_LIMIT,
  SEO_BATCH_MAX,
  SEO_PREVIEW_COUNT,
  type SeoCandidate,
} from "@/lib/products/seo-candidates";
import { generateSeoBatch, META_TITLE_MAX, META_DESCRIPTION_MAX, type SeoGenerated } from "@/lib/ai/seo-producto";
import { writeSeoFields } from "@/lib/products/odoo-catalog-write";
import { translateOdooError } from "@/lib/odoo-write";

/**
 * Generacion de textos SEO para las fichas de producto, en dos pasos y los
 * dos por clic del usuario:
 *
 *  1. `previewSeo`: elige las candidatas y genera las primeras 5 para que
 *     el usuario vea que va a escribir antes de confirmar.
 *  2. `writeSeoBatch`: escribe esas 5 tal cual se mostraron, genera el resto
 *     del lote y lo escribe. Deja el conteo en Setting `seo.ultimaCorrida`.
 *
 * Nada de esto corre desde el sync ni desde un cron.
 */

// Un archivo "use server" solo puede exportar funciones async; los tipos y
// las constantes quedan internos o en seo-candidates.ts.
const SETTING_ULTIMA_CORRIDA = "seo.ultimaCorrida";

type SeoPreviewResult =
  | { ok: true; total: number; preview: SeoGenerated[]; previewFailed: number }
  | { ok: false; error: string };

type SeoWriteResult =
  | {
      ok: true;
      written: number;
      failed: Array<{ templateId: number; name: string; error: string }>;
      /** URLs publicas de las primeras escritas, para verificar a ojo. */
      sample: Array<{ templateId: number; name: string }>;
    }
  | { ok: false; error: string };

export type SeoUltimaCorrida = { at: string; written: number; failed: number };

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("No autorizado");
  return session;
}

const limitSchema = z.number().int().min(1).max(SEO_BATCH_MAX).default(SEO_BATCH_LIMIT);

const generatedSchema = z.object({
  templateId: z.number().int().positive(),
  name: z.string().min(1),
  websiteDescription: z.string().min(1).max(5000),
  metaTitle: z.string().min(1).max(META_TITLE_MAX),
  metaDescription: z.string().min(1).max(META_DESCRIPTION_MAX),
});

const writeSchema = z.object({
  limit: limitSchema,
  previewed: z.array(generatedSchema).max(SEO_PREVIEW_COUNT),
});

function toInput(c: SeoCandidate) {
  return {
    templateId: c.templateId,
    name: c.name,
    category: c.category,
    salePrice: c.salePrice,
    variantNames: c.variantNames,
  };
}

export async function previewSeo(input: { limit?: number }): Promise<SeoPreviewResult> {
  await requireSession();
  const limit = limitSchema.safeParse(input?.limit ?? SEO_BATCH_LIMIT);
  if (!limit.success) return { ok: false, error: `El tope debe estar entre 1 y ${SEO_BATCH_MAX}` };

  try {
    const candidatas = await loadSeoCandidates(limit.data);
    if (candidatas.length === 0) {
      return { ok: true, total: 0, preview: [], previewFailed: 0 };
    }
    const { generated, failed } = await generateSeoBatch(candidatas.slice(0, SEO_PREVIEW_COUNT).map(toInput));
    if (failed.length > 0) console.error("[seo] fallo la previsualizacion:", failed);
    return { ok: true, total: candidatas.length, preview: generated, previewFailed: failed.length };
  } catch (err) {
    console.error("[seo] fallo la previsualizacion:", err);
    return { ok: false, error: "No se pudieron generar los textos. Revisa la conexion con Odoo y la clave del modelo." };
  }
}

export async function writeSeoBatch(input: unknown): Promise<SeoWriteResult> {
  await requireSession();
  const parsed = writeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos invalidos" };
  }
  const { limit, previewed } = parsed.data;

  try {
    // Se vuelve a seleccionar en el servidor: lo previsualizado solo se
    // escribe si sigue siendo candidata (nadie le puso descripcion entre
    // tanto) y los ids no se aceptan del cliente a ciegas.
    const candidatas = await loadSeoCandidates(limit);
    const candidataPorId = new Map(candidatas.map((c) => [c.templateId, c]));
    const listas: SeoGenerated[] = previewed.filter((p) => candidataPorId.has(p.templateId));
    const yaListas = new Set(listas.map((p) => p.templateId));
    const porGenerar = candidatas.filter((c) => !yaListas.has(c.templateId));

    const { generated, failed } = await generateSeoBatch(porGenerar.map(toInput));
    const todas = [...listas, ...generated];

    const fallidas = [...failed];
    let written = 0;
    for (const ficha of todas) {
      try {
        await writeSeoFields(ficha.templateId, ficha);
        written += 1;
      } catch (err) {
        fallidas.push({ templateId: ficha.templateId, name: ficha.name, error: translateOdooError(err, "catalogo") });
      }
    }

    const registro: SeoUltimaCorrida = { at: new Date().toISOString(), written, failed: fallidas.length };
    await prisma.setting.upsert({
      where: { key: SETTING_ULTIMA_CORRIDA },
      create: { key: SETTING_ULTIMA_CORRIDA, value: JSON.stringify(registro) },
      update: { value: JSON.stringify(registro) },
    });
    console.info(`[seo] corrida: ${written} fichas escritas, ${fallidas.length} fallidas`);

    return {
      ok: true,
      written,
      failed: fallidas,
      sample: todas.slice(0, SEO_PREVIEW_COUNT).map((f) => ({ templateId: f.templateId, name: f.name })),
    };
  } catch (err) {
    console.error("[seo] fallo la corrida:", err);
    return { ok: false, error: "No se pudo completar la corrida. Revisa la conexion con Odoo." };
  }
}

/** Ultima corrida registrada, para mostrarla junto al boton. */
export async function getSeoUltimaCorrida(): Promise<SeoUltimaCorrida | null> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_ULTIMA_CORRIDA } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SeoUltimaCorrida;
  } catch {
    return null;
  }
}
