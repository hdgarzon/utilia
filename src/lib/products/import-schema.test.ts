import { describe, it, expect } from "vitest";
import { validateRow, rowIsCreatable } from "./import-schema";
import type { ImportRowInput } from "./import-types";
import type { CatalogOptions } from "./types";

const OPCIONES: CatalogOptions = {
  categories: [{ id: 1, name: "PAPELERIA" }],
  publicCategories: [{ id: 10, name: "PAPELERIA WEB" }],
  purchaseTaxes: [{ id: 20, name: "19% VAT" }],
  suppliers: [{ id: 30, name: "Distribuidora Demo" }],
};

function fila(over: Partial<ImportRowInput> = {}): ImportRowInput {
  return {
    name: "CUADERNO DEMO",
    productType: "consu",
    isStorable: true,
    qtyOnHand: null,
    stockMin: null,
    stockMax: null,
    salePrice: 1000,
    cost: 600,
    purchaseTaxIds: [],
    categoryId: null,
    imageUrl: null,
    imageData: null,
    isPublished: false,
    publicCategoryIds: [],
    showAvailability: false,
    availableInPos: false,
    supplierPartnerId: null,
    clientId: "test-client",
    rowIndex: 0,
    ...over,
  };
}

const campos = (e: ReturnType<typeof validateRow>) => e.map((x) => x.field);

describe("validateRow", () => {
  it("una fila minima valida no produce nada", () => {
    expect(validateRow(fila(), OPCIONES)).toEqual([]);
  });

  it("exige nombre no vacio", () => {
    expect(campos(validateRow(fila({ name: "" }), OPCIONES))).toContain("name");
    expect(campos(validateRow(fila({ name: "   " }), OPCIONES))).toContain("name");
  });

  it("rechaza un tipo de producto desconocido", () => {
    // @ts-expect-error se fuerza un tipo invalido a proposito
    expect(campos(validateRow(fila({ productType: "kit" }), OPCIONES))).toContain("productType");
  });

  it("un servicio no puede llevar rastreo de inventario", () => {
    const e = validateRow(fila({ productType: "service", isStorable: true }), OPCIONES);
    expect(campos(e)).toContain("isStorable");
  });

  it("un combo tampoco puede llevar rastreo de inventario", () => {
    const e = validateRow(fila({ productType: "combo", isStorable: true }), OPCIONES);
    expect(campos(e)).toContain("isStorable");
  });

  it("un servicio sin rastreo es valido", () => {
    expect(validateRow(fila({ productType: "service", isStorable: false }), OPCIONES)).toEqual([]);
  });

  it("un servicio no puede llevar cantidad a la mano", () => {
    const e = validateRow(fila({ productType: "service", isStorable: false, qtyOnHand: 5 }), OPCIONES);
    expect(campos(e)).toContain("qtyOnHand");
  });

  it("rechaza precios negativos", () => {
    expect(campos(validateRow(fila({ salePrice: -1 }), OPCIONES))).toContain("salePrice");
    expect(campos(validateRow(fila({ cost: -1 }), OPCIONES))).toContain("cost");
  });

  it("acepta precio y costo en cero", () => {
    expect(validateRow(fila({ salePrice: 0, cost: 0 }), OPCIONES)).toEqual([]);
  });

  it("rechaza cantidad negativa", () => {
    expect(campos(validateRow(fila({ qtyOnHand: -3 }), OPCIONES))).toContain("qtyOnHand");
  });

  it("la categoria debe existir en el catalogo", () => {
    expect(validateRow(fila({ categoryId: 1 }), OPCIONES)).toEqual([]);
    expect(campos(validateRow(fila({ categoryId: 999 }), OPCIONES))).toContain("categoryId");
  });

  it("el impuesto de compra debe existir", () => {
    expect(validateRow(fila({ purchaseTaxIds: [20] }), OPCIONES)).toEqual([]);
    expect(campos(validateRow(fila({ purchaseTaxIds: [999] }), OPCIONES))).toContain("purchaseTaxIds");
  });

  it("la categoria web debe existir", () => {
    expect(campos(validateRow(fila({ publicCategoryIds: [999] }), OPCIONES))).toContain("publicCategoryIds");
  });

  it("el proveedor debe existir", () => {
    expect(campos(validateRow(fila({ supplierPartnerId: 999 }), OPCIONES))).toContain("supplierPartnerId");
  });

  it("la imagen por link debe ser http o https", () => {
    expect(validateRow(fila({ imageUrl: "https://x.co/a.jpg" }), OPCIONES)).toEqual([]);
    expect(campos(validateRow(fila({ imageUrl: "ftp://x.co/a.jpg" }), OPCIONES))).toContain("imageUrl");
    expect(campos(validateRow(fila({ imageUrl: "no soy una url" }), OPCIONES))).toContain("imageUrl");
  });

  it("publicar sin categoria web es advertencia, no error", () => {
    const e = validateRow(fila({ isPublished: true }), OPCIONES);
    expect(e).toHaveLength(1);
    expect(e[0].field).toBe("publicCategoryIds");
    expect(e[0].level).toBe("warning");
  });

  it("publicar con categoria web no advierte nada", () => {
    expect(validateRow(fila({ isPublished: true, publicCategoryIds: [10] }), OPCIONES)).toEqual([]);
  });
});

describe("rowIsCreatable", () => {
  it("una fila sin problemas se puede crear", () => {
    expect(rowIsCreatable([])).toBe(true);
  });

  it("una fila con solo advertencias se puede crear", () => {
    expect(rowIsCreatable([{ field: "publicCategoryIds", message: "x", level: "warning" }])).toBe(true);
  });

  it("una fila con un error no se puede crear", () => {
    expect(rowIsCreatable([{ field: "name", message: "x", level: "error" }])).toBe(false);
  });
});
