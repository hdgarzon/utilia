import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/odoo", () => ({ odooRpc: { executeKw: vi.fn(), searchRead: vi.fn() } }));
vi.mock("@/lib/analytics/abc", () => ({ getABCAnalysis: vi.fn() }));

import { selectSeoCandidates, groupSeoInsights, htmlTieneTexto, type SeoInsight } from "./seo-candidates";
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

const sinFiltros = { tierOf: new Map<number, ABCTier>(), conDescripcion: new Set<number>() };

describe("selectSeoCandidates", () => {
  it("pone primero A, luego B, luego C y al final sin clase", () => {
    const insights = [
      insight({ odooProductId: 1, avgDailySales30d: 9 }),
      insight({ odooProductId: 2, avgDailySales30d: 1 }),
      insight({ odooProductId: 3, avgDailySales30d: 5 }),
      insight({ odooProductId: 4, avgDailySales30d: 50 }),
    ];
    const tierOf = new Map<number, ABCTier>([
      [1, "C"],
      [2, "A"],
      [3, "B"],
    ]);
    const r = selectSeoCandidates(insights, { ...sinFiltros, tierOf });
    expect(r.map((c) => c.templateId)).toEqual([2, 3, 1, 4]);
  });

  it("dentro de la misma clase ordena por venta diaria", () => {
    const insights = [
      insight({ odooProductId: 1, avgDailySales30d: 1 }),
      insight({ odooProductId: 2, avgDailySales30d: 3 }),
      insight({ odooProductId: 3, avgDailySales30d: 2 }),
    ];
    const tierOf = new Map<number, ABCTier>([
      [1, "A"],
      [2, "A"],
      [3, "A"],
    ]);
    const r = selectSeoCandidates(insights, { ...sinFiltros, tierOf });
    expect(r.map((c) => c.templateId)).toEqual([2, 3, 1]);
  });

  it("excluye los que ya tienen descripcion en Odoo", () => {
    const insights = [insight({ odooProductId: 1 }), insight({ odooProductId: 2 })];
    const r = selectSeoCandidates(insights, { ...sinFiltros, conDescripcion: new Set([1]) });
    expect(r.map((c) => c.templateId)).toEqual([2]);
  });

  it("excluye los sin stock y, si se pasa la lista, los no publicados", () => {
    const insights = [
      insight({ odooProductId: 1, stockQty: 0 }),
      insight({ odooProductId: 2 }),
      insight({ odooProductId: 3 }),
    ];
    const r = selectSeoCandidates(insights, { ...sinFiltros, publicados: new Set([2]) });
    expect(r.map((c) => c.templateId)).toEqual([2]);
  });

  it("respeta el tope", () => {
    const insights = Array.from({ length: 80 }, (_, i) => insight({ odooProductId: i + 1 }));
    expect(selectSeoCandidates(insights, sinFiltros)).toHaveLength(50);
    expect(selectSeoCandidates(insights, sinFiltros, 7)).toHaveLength(7);
    expect(selectSeoCandidates(insights, sinFiltros, 0)).toHaveLength(0);
  });

  it("agrupa variantes en una sola ficha, con stock sumado y nombres de variante", () => {
    const insights = [
      insight({ odooProductId: 11, odooTemplateId: 1, templateName: "GLOBO", name: "GLOBO (Rojo)", stockQty: 2, avgDailySales30d: 1 }),
      insight({ odooProductId: 12, odooTemplateId: 1, templateName: "GLOBO", name: "GLOBO (Azul)", stockQty: 3, avgDailySales30d: 4 }),
      insight({ odooProductId: 13, odooTemplateId: null }),
    ];
    const r = groupSeoInsights(insights);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ templateId: 1, name: "GLOBO", stockQty: 5, avgDailySales30d: 5 });
    expect(r[0].variantNames).toEqual(["GLOBO (Rojo)", "GLOBO (Azul)"]);
  });
});

describe("htmlTieneTexto", () => {
  it("trata el html vacio de Odoo como sin descripcion", () => {
    expect(htmlTieneTexto(false)).toBe(false);
    expect(htmlTieneTexto("<p><br></p>")).toBe(false);
    expect(htmlTieneTexto("<p>&nbsp;</p>")).toBe(false);
    expect(htmlTieneTexto("<p>Cuaderno de 100 hojas</p>")).toBe(true);
  });
});
