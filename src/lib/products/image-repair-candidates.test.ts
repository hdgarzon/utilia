import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/odoo", () => ({ odooRpc: { executeKw: vi.fn(), searchRead: vi.fn() } }));
vi.mock("@/lib/analytics/abc", () => ({ getABCAnalysis: vi.fn() }));

import { orderImageCandidates, scanForRepairs, type ImageRepairCandidate } from "./image-repair-candidates";
import type { SeoInsight } from "./seo-candidates";
import type { ABCTier } from "@/lib/analytics/abc";

function insight(over: Partial<SeoInsight> & { odooProductId: number }): SeoInsight {
  return {
    odooTemplateId: over.odooProductId,
    templateName: null,
    name: `PRODUCTO ${over.odooProductId}`,
    category: "Papeleria",
    stockQty: 10,
    salePrice: 5000,
    avgDailySales30d: 1,
    ...over,
  };
}

function candidata(templateId: number): ImageRepairCandidate {
  return { templateId, name: `P${templateId}`, category: null, salePrice: 1, stockQty: 1, avgDailySales30d: 1, tier: null };
}

/** Producto chico sobre blanco (califica) o lleno de color (no califica). */
async function foto(califica: boolean): Promise<Buffer> {
  if (!califica) {
    return sharp({ create: { width: 600, height: 600, channels: 3, background: "#d02020" } }).png().toBuffer();
  }
  const producto = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#d02020" } })
    .png()
    .toBuffer();
  return sharp({ create: { width: 600, height: 600, channels: 3, background: "#ffffff" } })
    .composite([{ input: producto, gravity: "center" }])
    .png()
    .toBuffer();
}

describe("orderImageCandidates", () => {
  it("ordena por clase ABC y luego por venta diaria", () => {
    const tierOf = new Map<number, ABCTier>([
      [1, "C"],
      [2, "A"],
      [3, "B"],
      [4, "A"],
    ]);
    const insights = [
      insight({ odooProductId: 1, avgDailySales30d: 9 }),
      insight({ odooProductId: 2, avgDailySales30d: 1 }),
      insight({ odooProductId: 3, avgDailySales30d: 5 }),
      insight({ odooProductId: 4, avgDailySales30d: 3 }),
      insight({ odooProductId: 5, avgDailySales30d: 20 }),
    ];
    const r = orderImageCandidates(insights, { tierOf, publicados: new Set([1, 2, 3, 4, 5]) });
    expect(r.map((c) => c.templateId)).toEqual([4, 2, 3, 1, 5]);
  });

  it("deja fuera las no publicadas y las sin stock", () => {
    const insights = [
      insight({ odooProductId: 1 }),
      insight({ odooProductId: 2, stockQty: 0 }),
      insight({ odooProductId: 3 }),
    ];
    const r = orderImageCandidates(insights, { tierOf: new Map(), publicados: new Set([1, 2]) });
    expect(r.map((c) => c.templateId)).toEqual([1]);
  });

  it("consolida las variantes en una ficha", () => {
    const insights = [
      insight({ odooProductId: 10, odooTemplateId: 7, stockQty: 2 }),
      insight({ odooProductId: 11, odooTemplateId: 7, stockQty: 3 }),
    ];
    const r = orderImageCandidates(insights, { tierOf: new Map(), publicados: new Set([7]) });
    expect(r).toHaveLength(1);
    expect(r[0].stockQty).toBe(5);
  });
});

describe("scanForRepairs", () => {
  it("devuelve solo las que califican, en orden, y corta en el tope", async () => {
    const buena = await foto(true);
    const mala = await foto(false);
    const fotos = new Map<number, Buffer>([
      [1, mala],
      [2, buena],
      [3, buena],
      [4, buena],
    ]);
    const read = vi.fn(async (ids: number[]) => new Map(ids.flatMap((id) => (fotos.has(id) ? [[id, fotos.get(id)!] as const] : []))));
    const r = await scanForRepairs([1, 2, 3, 4].map(candidata), read, 2);
    expect(r.map((t) => t.templateId)).toEqual([2, 3]);
    expect(r[0].analysis.ocupacion).toBeCloseTo(1 / 3, 2);
  });

  it("salta las fichas sin foto y las fotos que no se pueden abrir", async () => {
    const buena = await foto(true);
    const read = async () =>
      new Map<number, Buffer>([
        [2, Buffer.from("no es una imagen")],
        [3, buena],
      ]);
    const r = await scanForRepairs([1, 2, 3].map(candidata), read, 10);
    expect(r.map((t) => t.templateId)).toEqual([3]);
  });

  it("deja de leer de Odoo cuando ya junto el tope", async () => {
    const buena = await foto(true);
    const read = vi.fn(async (ids: number[]) => new Map(ids.map((id) => [id, buena] as const)));
    const candidatas = Array.from({ length: 60 }, (_, i) => candidata(i + 1));
    await scanForRepairs(candidatas, read, 5);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
