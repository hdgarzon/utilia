import { prisma } from "@/lib/prisma";
import { odooRpc } from "@/lib/odoo";
import { getABCAnalysis, type ABCTier } from "@/lib/analytics/abc";
import { groupSeoInsights, type SeoCandidate, type SeoInsight } from "./seo-candidates";
import { IMAGE_REPAIR_LIMIT } from "./image-repair-limits";
import { analyzeImage, needsRepair, type ImageAnalysis } from "./image-repair";

/**
 * Seleccion de fichas cuya foto principal se repara (recorte del margen
 * blanco y cuadrado). Mismo universo y orden que el generador SEO: fichas
 * publicadas con stock, clase A, B, C y sin clase, y dentro de cada clase
 * por venta diaria 30d.
 *
 * Que una ficha califique depende de la foto, que solo se conoce leyendola
 * de Odoo; por eso se ordena primero y se leen las fotos por tandas en ese
 * orden hasta juntar el tope, en vez de bajar las 1.200 fotos del catalogo.
 */

export type ImageRepairCandidate = Omit<SeoCandidate, "variantNames">;

export interface ImageSelectionContext {
  tierOf: Map<number, ABCTier>;
  publicados: Set<number>;
}

const TIER_ORDER: Record<ABCTier, number> = { A: 0, B: 1, C: 2 };
const SIN_CLASE = 3;
/** Fotos por llamada a Odoo: cada image_1920 puede pesar cientos de KB. */
const LOTE_LECTURA = 20;

/** Fichas publicadas con stock, en orden de prioridad. Sin mirar la foto. */
export function orderImageCandidates(
  insights: SeoInsight[],
  ctx: ImageSelectionContext
): ImageRepairCandidate[] {
  return groupSeoInsights(insights)
    .map(({ variantNames: _v, ...p }) => ({ ...p, tier: ctx.tierOf.get(p.templateId) ?? null }))
    .filter((p) => p.stockQty > 0 && ctx.publicados.has(p.templateId))
    .sort((a, b) => {
      const ta = a.tier ? TIER_ORDER[a.tier] : SIN_CLASE;
      const tb = b.tier ? TIER_ORDER[b.tier] : SIN_CLASE;
      if (ta !== tb) return ta - tb;
      if (b.avgDailySales30d !== a.avgDailySales30d) return b.avgDailySales30d - a.avgDailySales30d;
      return a.name.localeCompare(b.name, "es");
    });
}

export interface ImageRepairTarget extends ImageRepairCandidate {
  original: Buffer;
  analysis: ImageAnalysis;
}

/** Lee la foto principal de varias fichas. Ausente o vacia = sin foto. */
export type ImageReader = (templateIds: number[]) => Promise<Map<number, Buffer>>;

/**
 * Recorre las candidatas en orden, leyendo las fotos por tandas, y devuelve
 * las primeras `limit` que conviene reparar. Las fichas sin foto o con una
 * foto que sharp no puede abrir se saltan: no hay nada que reparar.
 */
export async function scanForRepairs(
  candidates: ImageRepairCandidate[],
  read: ImageReader,
  limit: number
): Promise<ImageRepairTarget[]> {
  const out: ImageRepairTarget[] = [];
  for (let i = 0; i < candidates.length && out.length < limit; i += LOTE_LECTURA) {
    const lote = candidates.slice(i, i + LOTE_LECTURA);
    const fotos = await read(lote.map((c) => c.templateId));
    for (const c of lote) {
      if (out.length >= limit) break;
      const original = fotos.get(c.templateId);
      if (!original) continue;
      const analysis = await analyzeImage(original).catch(() => null);
      if (analysis && needsRepair(analysis)) out.push({ ...c, original, analysis });
    }
  }
  return out;
}

const leerFotosDeOdoo: ImageReader = async (ids) => {
  const rows = await odooRpc.searchRead<{ id: number; image_1920: string | false }>(
    "product.template",
    [["id", "in", ids]],
    ["id", "image_1920"],
    { limit: ids.length, timeoutMs: 120_000 }
  );
  const out = new Map<number, Buffer>();
  for (const r of rows) {
    if (typeof r.image_1920 === "string" && r.image_1920.length > 0) {
      out.set(r.id, Buffer.from(r.image_1920, "base64"));
    }
  }
  return out;
};

/** Fichas a reparar en esta corrida, leidas de Postgres y Odoo. */
export async function loadImageRepairs(limit: number = IMAGE_REPAIR_LIMIT): Promise<ImageRepairTarget[]> {
  const [insights, abc, publicadosRaw] = await Promise.all([
    prisma.productInsight.findMany({
      where: { odooTemplateId: { not: null }, stockQty: { gt: 0 } },
      select: {
        odooProductId: true,
        odooTemplateId: true,
        templateName: true,
        name: true,
        category: true,
        stockQty: true,
        salePrice: true,
        avgDailySales30d: true,
      },
    }),
    getABCAnalysis(),
    odooRpc.searchRead<{ id: number }>(
      "product.template",
      [["is_published", "=", true], ["sale_ok", "=", true]],
      ["id"],
      { limit: 10000 }
    ),
  ]);
  // getABCAnalysis expone el id del template en `odooProductId` cuando lo hay.
  const tierOf = new Map<number, ABCTier>(abc.products.map((p) => [p.odooProductId, p.tier]));
  const publicados = new Set(publicadosRaw.map((t) => t.id));
  const ordenadas = orderImageCandidates(insights, { tierOf, publicados });
  return scanForRepairs(ordenadas, leerFotosDeOdoo, limit);
}
