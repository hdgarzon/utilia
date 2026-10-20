import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/analytics/abc", () => ({ getABCAnalysis: vi.fn() }));

import {
  META_CATALOG_COLUMNS,
  buildMetaCatalogRow,
  formatMetaPrice,
  selectMetaCatalogProducts,
  toCollectionName,
  toMetaCatalogCsv,
  type CatalogInsight,
  type CatalogProduct,
} from "./meta-catalog-export";
import type { ABCTier } from "@/lib/analytics/abc";

function variant(over: Partial<CatalogInsight> & { odooProductId: number }): CatalogInsight {
  return {
    odooTemplateId: over.odooProductId * 10,
    templateName: null,
    name: `Producto ${over.odooProductId}`,
    category: "PAPELERÍA",
    stockQty: 5,
    salePrice: 1000,
    avgDailySales30d: 1,
    rotationDays: 3,
    ...over,
  };
}

const opts = { publicBaseUrl: "https://utilia.example.com", odooBaseUrl: "https://odoo.example.com", brand: "Tienda Demo" };

describe("selectMetaCatalogProducts", () => {
  it("no duplica templates: las variantes salen como un solo producto con el stock sumado", () => {
    const insights = [
      variant({ odooProductId: 1, odooTemplateId: 100, templateName: "Vela numero", name: "Vela numero (5)", stockQty: 2, avgDailySales30d: 0.5, salePrice: 900 }),
      variant({ odooProductId: 2, odooTemplateId: 100, templateName: "Vela numero", name: "Vela numero (7)", stockQty: 3, avgDailySales30d: 2, salePrice: 1100 }),
      variant({ odooProductId: 3, odooTemplateId: 200, name: "Cuaderno" }),
    ];
    const out = selectMetaCatalogProducts(insights, new Map());
    expect(out).toHaveLength(2);
    const vela = out.find((p) => p.templateId === 100)!;
    expect(vela.name).toBe("Vela numero");
    expect(vela.stockQty).toBe(5);
    expect(vela.avgDailySales30d).toBe(2.5);
    // El precio es el de la variante que mas vende.
    expect(vela.salePrice).toBe(1100);
  });

  it("prioriza A, luego B, luego C y al final lo que no tiene clase; dentro de cada clase por venta", () => {
    const insights = [
      variant({ odooProductId: 1, avgDailySales30d: 9 }), // sin clase
      variant({ odooProductId: 2, avgDailySales30d: 1 }), // C
      variant({ odooProductId: 3, avgDailySales30d: 1 }), // B
      variant({ odooProductId: 4, avgDailySales30d: 1 }), // A, vende menos
      variant({ odooProductId: 5, avgDailySales30d: 3 }), // A, vende mas
    ];
    const tierOf = new Map<number, ABCTier>([
      [20, "C"],
      [30, "B"],
      [40, "A"],
      [50, "A"],
    ]);
    const out = selectMetaCatalogProducts(insights, tierOf);
    expect(out.map((p) => p.templateId)).toEqual([50, 40, 30, 20, 10]);
    expect(out.map((p) => p.tier)).toEqual(["A", "A", "B", "C", null]);
  });

  it("corta en el tope de 500 y deja fuera primero lo de menor prioridad", () => {
    const insights: CatalogInsight[] = [];
    for (let i = 1; i <= 520; i++) insights.push(variant({ odooProductId: i, avgDailySales30d: i }));
    // Los 20 de menor venta son clase A: deben entrar aunque vendan menos.
    const tierOf = new Map<number, ABCTier>();
    for (let i = 1; i <= 20; i++) tierOf.set(i * 10, "A");
    const out = selectMetaCatalogProducts(insights, tierOf);
    expect(out).toHaveLength(500);
    expect(out.slice(0, 20).every((p) => p.tier === "A")).toBe(true);
    // Sin clase, quedan afuera los 20 que menos venden (21..40).
    const ids = new Set(out.map((p) => p.templateId));
    for (let i = 21; i <= 40; i++) expect(ids.has(i * 10)).toBe(false);
    expect(ids.has(5200)).toBe(true);
  });

  it("excluye sin stock, sin venta en 30 dias y sin precio", () => {
    const insights = [
      variant({ odooProductId: 1, stockQty: 0 }),
      variant({ odooProductId: 2, rotationDays: 31 }),
      variant({ odooProductId: 3, salePrice: 0 }),
      variant({ odooProductId: 4, rotationDays: 30 }),
    ];
    const out = selectMetaCatalogProducts(insights, new Map());
    expect(out.map((p) => p.templateId)).toEqual([40]);
  });

  it("un template entra si alguna variante vendio hace poco, aunque otra lleve meses", () => {
    const insights = [
      variant({ odooProductId: 1, odooTemplateId: 100, rotationDays: 90, stockQty: 0 }),
      variant({ odooProductId: 2, odooTemplateId: 100, rotationDays: 2, stockQty: 1 }),
    ];
    expect(selectMetaCatalogProducts(insights, new Map())).toHaveLength(1);
  });

  it("una variante sin template se agrupa por si misma", () => {
    const insights = [variant({ odooProductId: 7, odooTemplateId: null })];
    const out = selectMetaCatalogProducts(insights, new Map());
    expect(out[0].templateId).toBeNull();
    expect(out[0].odooProductId).toBe(7);
  });
});

describe("formato de filas", () => {
  const producto: CatalogProduct = {
    templateId: 123,
    odooProductId: 9,
    name: "  Cinta   decorativa \"Fiesta\", 10 m ",
    category: "PIÑATERÍA",
    stockQty: 4,
    salePrice: 8800.4,
    avgDailySales30d: 1,
    rotationDays: 1,
    tier: "A",
  };

  it("arma la fila con las columnas de Meta", () => {
    const row = buildMetaCatalogRow(producto, opts);
    expect(row).toEqual({
      id: "tmpl-123",
      title: 'Cinta decorativa "Fiesta", 10 m',
      description: 'Cinta decorativa "Fiesta", 10 m. Piñateria. Disponible en tienda, escríbenos por WhatsApp para pedirlo.',
      availability: "in stock",
      condition: "new",
      price: "8800 COP",
      link: "https://odoo.example.com/shop/123",
      image_link: "https://utilia.example.com/api/catalog/image/123?kind=template",
      brand: "Tienda Demo",
      product_type: "Piñateria",
      google_product_category: "Arts & Entertainment > Party & Celebration > Party Supplies",
      custom_label_0: "Piñateria",
    });
  });

  it("sin template usa la variante en el id y en la imagen", () => {
    const row = buildMetaCatalogRow({ ...producto, templateId: null }, opts);
    expect(row.id).toBe("prod-9");
    expect(row.image_link).toBe("https://utilia.example.com/api/catalog/image/9?kind=variant");
    expect(row.link).toBe("https://odoo.example.com/shop");
  });

  it("precio sin decimales en COP", () => {
    expect(formatMetaPrice(8800)).toBe("8800 COP");
    expect(formatMetaPrice(1250.5)).toBe("1251 COP");
  });

  it("coleccion: sin tildes, con eñe, primera letra mayuscula", () => {
    expect(toCollectionName("PAPELERÍA")).toBe("Papeleria");
    expect(toCollectionName("PIÑATERÍA")).toBe("Piñateria");
    expect(toCollectionName("JOYERÍA Y ACCESORIOS")).toBe("Joyeria y accesorios");
    expect(toCollectionName("CUIDADO PERSONAL")).toBe("Cuidado personal");
    expect(toCollectionName("All / Deliveries")).toBe("Deliveries");
    expect(toCollectionName("All")).toBe("Otros");
    expect(toCollectionName(null)).toBe("Otros");
  });

  it("el CSV escapa comas, comillas y saltos de linea", () => {
    const csv = toMetaCatalogCsv([
      buildMetaCatalogRow(producto, opts),
      buildMetaCatalogRow({ ...producto, templateId: 124, name: "Linea 1\nLinea 2" }, opts),
    ]);
    const [header, line1, line2, resto] = csv.split("\r\n");
    expect(header).toBe(META_CATALOG_COLUMNS.join(","));
    expect(line1).toContain('"Cinta decorativa ""Fiesta"", 10 m"');
    expect(line2.startsWith("tmpl-124,Linea 1 Linea 2,")).toBe(true);
    expect(line2).toContain('"Linea 1 Linea 2. Piñateria. Disponible en tienda, escríbenos por WhatsApp para pedirlo."');
    expect(resto).toBe("");
  });
});
