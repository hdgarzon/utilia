import { describe, it, expect } from "vitest";
import { buildCatalogDomain } from "./domain";

describe("buildCatalogDomain", () => {
  it("sin filtros devuelve un dominio vacio", () => {
    expect(buildCatalogDomain({})).toEqual([]);
  });

  it("la busqueda cubre nombre y referencia interna con OR", () => {
    expect(buildCatalogDomain({ query: "cuaderno" })).toEqual([
      "|",
      ["name", "ilike", "cuaderno"],
      ["default_code", "ilike", "cuaderno"],
    ]);
  });

  it("ignora una busqueda de solo espacios", () => {
    expect(buildCatalogDomain({ query: "   " })).toEqual([]);
  });

  it("recorta los espacios de la busqueda", () => {
    expect(buildCatalogDomain({ query: "  lapiz " })).toEqual([
      "|",
      ["name", "ilike", "lapiz"],
      ["default_code", "ilike", "lapiz"],
    ]);
  });

  it("filtra por categoria interna y por tipo", () => {
    expect(buildCatalogDomain({ categoryId: 5, type: "service" })).toEqual([
      ["categ_id", "=", 5],
      ["type", "=", "service"],
    ]);
  });

  it("filtra por categoria de ecommerce con el operador in", () => {
    expect(buildCatalogDomain({ publicCategoryId: 9 })).toEqual([
      ["public_categ_ids", "in", [9]],
    ]);
  });

  it("distingue publicado false de publicado ausente", () => {
    expect(buildCatalogDomain({ published: false })).toEqual([["is_published", "=", false]]);
    expect(buildCatalogDomain({})).toEqual([]);
  });

  it("traduce cada filtro de problema", () => {
    expect(buildCatalogDomain({ problem: "sin_imagen" })).toEqual([["image_1920", "=", false]]);
    expect(buildCatalogDomain({ problem: "sin_categoria_web" })).toEqual([
      ["public_categ_ids", "=", false],
    ]);
    expect(buildCatalogDomain({ problem: "sin_proveedor" })).toEqual([["seller_ids", "=", false]]);
    expect(buildCatalogDomain({ problem: "sin_impuesto" })).toEqual([
      ["supplier_taxes_id", "=", false],
    ]);
    expect(buildCatalogDomain({ problem: "sin_publicar" })).toEqual([["is_published", "=", false]]);
  });

  it("combina busqueda con filtros: el OR aplica solo a sus dos terminos", () => {
    expect(buildCatalogDomain({ query: "vela", categoryId: 2 })).toEqual([
      "|",
      ["name", "ilike", "vela"],
      ["default_code", "ilike", "vela"],
      ["categ_id", "=", 2],
    ]);
  });
});
