import { prisma } from "@/lib/prisma";
import { odooRpc } from "@/lib/odoo";
import { getABCAnalysis, type ABCTier } from "@/lib/analytics/abc";

/**
 * Seleccion de fichas de producto a las que se les genera texto SEO.
 *
 * Se trabaja por template (la ficha publica del sitio es una por template,
 * no por variante), solo con stock y solo publicadas: una ficha sin stock o
 * sin publicar no se indexa, y gastar una generacion en ella es gastar el
 * cupo de la corrida. Se priorizan las clases A y B del ABC, que son las que
 * mas venden y las que mas conviene posicionar; C y sin clase entran despues.
 *
 * Las que ya tienen `website_description` en Odoo se omiten: el texto escrito
 * a mano por el dueño vale mas que el generado, y asi cada corrida avanza
 * sobre fichas nuevas en vez de reescribir las mismas.
 */

/** Tope por defecto de fichas por corrida. Controla el costo del modelo. */
export const SEO_BATCH_LIMIT = 50;
/** Tope maximo que acepta la accion, por tiempo de la funcion serverless. */
export const SEO_BATCH_MAX = 200;
/** Fichas que se muestran en la previsualizacion antes de confirmar. */
export const SEO_PREVIEW_COUNT = 5;

/** Lo que la seleccion necesita de cada variante de ProductInsight. */
export interface SeoInsight {
  odooProductId: number;
  odooTemplateId: number | null;
  templateName: string | null;
  name: string;
  category: string | null;
  stockQty: number;
  salePrice: number;
  avgDailySales30d: number;
}

/** Una ficha candidata: un template con sus variantes consolidadas. */
export interface SeoCandidate {
  templateId: number;
  name: string;
  category: string | null;
  salePrice: number;
  stockQty: number;
  avgDailySales30d: number;
  /** Nombres de las variantes, solo cuando hay mas de una. */
  variantNames: string[];
  tier: ABCTier | null;
}

export interface SeoSelectionContext {
  /** Clase ABC por id de template (salida de `getABCAnalysis`). */
  tierOf: Map<number, ABCTier>;
  /** Templates que ya tienen descripcion web en Odoo. */
  conDescripcion: Set<number>;
  /** Templates publicados en el sitio. Si no se pasa, no se filtra. */
  publicados?: Set<number>;
}

const TIER_ORDER: Record<ABCTier, number> = { A: 0, B: 1, C: 2 };
const SIN_CLASE = 3;

/** Agrupa las variantes por template. Las variantes sin template no tienen ficha. */
export function groupSeoInsights(insights: SeoInsight[]): SeoCandidate[] {
  const groups = new Map<number, SeoInsight[]>();
  for (const p of insights) {
    if (p.odooTemplateId === null) continue;
    const g = groups.get(p.odooTemplateId) ?? [];
    g.push(p);
    groups.set(p.odooTemplateId, g);
  }
  return Array.from(groups.entries()).map(([templateId, variants]) => {
    const rep = variants.reduce(
      (best, v) => (v.avgDailySales30d > best.avgDailySales30d ? v : best),
      variants[0]
    );
    return {
      templateId,
      name: rep.templateName ?? rep.name,
      category: rep.category,
      salePrice: rep.salePrice,
      stockQty: variants.reduce((s, v) => s + v.stockQty, 0),
      avgDailySales30d: variants.reduce((s, v) => s + v.avgDailySales30d, 0),
      variantNames: variants.length > 1 ? variants.map((v) => v.name) : [],
      tier: null,
    };
  });
}

/**
 * Elige las fichas de la corrida: con stock, publicadas y sin descripcion,
 * ordenadas por clase (A, B, C, sin clase) y dentro de cada clase por venta
 * diaria, cortando en `limit`.
 */
export function selectSeoCandidates(
  insights: SeoInsight[],
  ctx: SeoSelectionContext,
  limit: number = SEO_BATCH_LIMIT
): SeoCandidate[] {
  return groupSeoInsights(insights)
    .map((p) => ({ ...p, tier: ctx.tierOf.get(p.templateId) ?? null }))
    .filter(
      (p) =>
        p.stockQty > 0 &&
        !ctx.conDescripcion.has(p.templateId) &&
        (ctx.publicados === undefined || ctx.publicados.has(p.templateId))
    )
    .sort((a, b) => {
      const ta = a.tier ? TIER_ORDER[a.tier] : SIN_CLASE;
      const tb = b.tier ? TIER_ORDER[b.tier] : SIN_CLASE;
      if (ta !== tb) return ta - tb;
      if (b.avgDailySales30d !== a.avgDailySales30d) return b.avgDailySales30d - a.avgDailySales30d;
      return a.name.localeCompare(b.name, "es");
    })
    .slice(0, Math.max(0, limit));
}

/** Quita etiquetas y espacios: una descripcion `<p><br></p>` cuenta como vacia. */
export function htmlTieneTexto(html: string | false | null | undefined): boolean {
  if (!html) return false;
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim().length > 0;
}

interface OdooSeoTemplate {
  id: number;
  website_description: string | false;
  is_published: boolean;
}

/**
 * Lee de Odoo que templates ya tienen descripcion web y cuales estan
 * publicados. Solo lectura. Se consulta `product.template` directamente
 * porque esos campos no viven en ProductInsight.
 */
async function leerEstadoWebDeOdoo(): Promise<{ conDescripcion: Set<number>; publicados: Set<number> }> {
  const [conTexto, publicadosRaw] = await Promise.all([
    odooRpc.searchRead<Pick<OdooSeoTemplate, "id" | "website_description">>(
      "product.template",
      [["website_description", "!=", false]],
      ["id", "website_description"],
      { limit: 10000 }
    ),
    odooRpc.searchRead<Pick<OdooSeoTemplate, "id">>(
      "product.template",
      [["is_published", "=", true], ["sale_ok", "=", true]],
      ["id"],
      { limit: 10000 }
    ),
  ]);
  return {
    conDescripcion: new Set(conTexto.filter((t) => htmlTieneTexto(t.website_description)).map((t) => t.id)),
    publicados: new Set(publicadosRaw.map((t) => t.id)),
  };
}

/** Candidatas de la corrida, leidas de Postgres y Odoo. */
export async function loadSeoCandidates(limit: number = SEO_BATCH_LIMIT): Promise<SeoCandidate[]> {
  const [insights, abc, web] = await Promise.all([
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
    leerEstadoWebDeOdoo(),
  ]);
  // getABCAnalysis consolida por template y expone el id del template en
  // `odooProductId` cuando lo hay.
  const tierOf = new Map<number, ABCTier>(abc.products.map((p) => [p.odooProductId, p.tier]));
  return selectSeoCandidates(insights, { tierOf, ...web }, limit);
}
