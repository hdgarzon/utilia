import { describe, it, expect, beforeEach, vi } from "vitest";

const { generateObject } = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("ai", () => ({ generateObject }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "modelo-mock" }));

import {
  generateSeoFields,
  generateSeoBatch,
  fitMetaTitle,
  fitMetaDescription,
  toTitleCase,
  sanitizeDescriptionHtml,
  buildSeoPrompt,
  META_TITLE_MAX,
  META_DESCRIPTION_MAX,
} from "./seo-producto";

beforeEach(() => {
  generateObject.mockReset();
});

const producto = {
  templateId: 42,
  name: "CUADERNO ARGOLLADO 100 HOJAS CUADRICULADO",
  category: "Papeleria",
  salePrice: 8900,
  variantNames: [],
};

describe("toTitleCase", () => {
  it("pasa mayusculas sostenidas a capitalizacion normal", () => {
    expect(toTitleCase("CUADERNO ARGOLLADO 100 HOJAS")).toBe("Cuaderno Argollado 100 hojas");
    expect(toTitleCase("GLOBO LATEX  12 PULGADAS X 50 UND")).toBe("Globo Latex 12 Pulgadas x 50 und");
    expect(toTitleCase("CINTA DE ENMASCARAR")).toBe("Cinta de Enmascarar");
  });
});

describe("fitMetaTitle", () => {
  it("agrega la marca cuando cabe", () => {
    expect(fitMetaTitle("Cuaderno Argollado")).toBe("Cuaderno Argollado | Utilia Sabaneta");
  });

  it("nunca pasa de 60 caracteres y no parte palabras", () => {
    const largo = "Cuaderno Argollado Cuadriculado Cien Hojas Siete Materias Tapa Dura Norma";
    const t = fitMetaTitle(largo);
    expect(t.length).toBeLessThanOrEqual(META_TITLE_MAX);
    expect(t.endsWith("| Utilia")).toBe(true);
    expect(t).not.toMatch(/\S{30,}/);
  });

  it("usa la marca corta cuando la larga no cabe", () => {
    const nombre = "Cuaderno Argollado Cuadriculado Cien Hojas"; // 42 chars
    expect(fitMetaTitle(`${nombre} Norma`)).toBe(`${nombre} Norma | Utilia`);
  });
});

describe("fitMetaDescription", () => {
  it("respeta el texto corto", () => {
    expect(fitMetaDescription("Compra tu cuaderno hoy.")).toBe("Compra tu cuaderno hoy.");
  });

  it("corta en palabra a 155 y cierra con punto", () => {
    const largo = Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(" ");
    const d = fitMetaDescription(largo);
    expect(d.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(d.endsWith(".")).toBe(true);
    // La ultima palabra queda entera: "palabraN." y no "palab."
    expect(d).toMatch(/palabra\d+\.$/);
  });
});

describe("sanitizeDescriptionHtml", () => {
  it("quita scripts, atributos y etiquetas fuera de la lista blanca", () => {
    const sucio = `<div class="x"><p onclick="alert(1)">Hola <strong>mundo</strong></p><script>evil()</script><img src=x></div>`;
    expect(sanitizeDescriptionHtml(sucio)).toBe("<p>Hola <strong>mundo</strong></p>");
  });

  it("envuelve texto plano en un parrafo", () => {
    expect(sanitizeDescriptionHtml("Texto suelto")).toBe("<p>Texto suelto</p>");
  });
});

describe("generateSeoFields (modelo mockeado)", () => {
  it("aplica los limites a lo que devuelve el modelo", async () => {
    generateObject.mockResolvedValue({
      object: {
        tituloCorto: "Cuaderno Argollado Cuadriculado Cien Hojas Siete Materias Tapa Dura",
        descripcionHtml: "<p>Un cuaderno para el colegio.</p><script>x()</script>",
        metaDescripcion: "A".repeat(200),
      },
    });
    const r = await generateSeoFields(producto);
    expect(r.templateId).toBe(42);
    expect(r.metaTitle.length).toBeLessThanOrEqual(META_TITLE_MAX);
    expect(r.metaTitle).toMatch(/\| Utilia/);
    expect(r.metaDescription.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(r.websiteDescription).toBe("<p>Un cuaderno para el colegio.</p>");
  });

  it("si el modelo no da titulo, usa el nombre en capitalizacion normal", async () => {
    generateObject.mockResolvedValue({
      object: { tituloCorto: "  ", descripcionHtml: "<p>Texto</p>", metaDescripcion: "Pide el tuyo." },
    });
    const r = await generateSeoFields(producto);
    expect(r.metaTitle).toBe("Cuaderno Argollado 100 hojas Cuadriculado | Utilia Sabaneta");
  });

  it("falla si la descripcion queda vacia tras limpiar", async () => {
    generateObject.mockResolvedValue({
      object: { tituloCorto: "X", descripcionHtml: "<script>a()</script>", metaDescripcion: "Y" },
    });
    await expect(generateSeoFields(producto)).rejects.toThrow(/vacia/);
  });

  it("manda al modelo solo los datos del producto", async () => {
    const prompt = buildSeoPrompt({ ...producto, variantNames: ["ROJO", "AZUL"] });
    expect(prompt).toContain("CUADERNO ARGOLLADO");
    expect(prompt).toContain("Papeleria");
    expect(prompt).toContain("Variantes: ROJO; AZUL");
  });
});

describe("generateSeoBatch", () => {
  it("separa generadas y fallidas y conserva el orden de prioridad", async () => {
    generateObject.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt.includes("FALLA")) throw new Error("timeout");
      return { object: { tituloCorto: "T", descripcionHtml: "<p>D</p>", metaDescripcion: "M." } };
    });
    const inputs = [
      { ...producto, templateId: 1, name: "UNO" },
      { ...producto, templateId: 2, name: "FALLA" },
      { ...producto, templateId: 3, name: "TRES" },
    ];
    const r = await generateSeoBatch(inputs, 2);
    expect(r.generated.map((g) => g.templateId)).toEqual([1, 3]);
    expect(r.failed).toEqual([{ templateId: 2, name: "FALLA", error: "timeout" }]);
  });
});
