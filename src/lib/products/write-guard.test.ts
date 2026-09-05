import { describe, it, expect } from "vitest";
import { assertWritable, assertModelAllowed, toOdooValues, WRITABLE_FIELDS } from "./write-guard";

describe("barrera de inventario", () => {
  it("rechaza los campos de cantidad", () => {
    for (const campo of ["qty_available", "inventory_quantity", "free_qty"]) {
      expect(() => assertWritable({ [campo]: 10 })).toThrow(/no permitido/i);
    }
  });

  it("rechaza un campo desconocido aunque venga junto a uno valido", () => {
    expect(() => assertWritable({ categ_id: 3, qty_available: 10 })).toThrow(/qty_available/);
  });

  it("acepta los campos de catalogo declarados", () => {
    expect(() => assertWritable({ categ_id: 3, is_published: true })).not.toThrow();
  });

  it("no deja entrar campos de inventario a la lista blanca", () => {
    for (const campo of ["qty_available", "inventory_quantity", "free_qty"]) {
      expect(WRITABLE_FIELDS.has(campo)).toBe(false);
    }
  });

  it("la lista blanca es exactamente los cinco campos que el modulo escribe", () => {
    expect(WRITABLE_FIELDS.size).toBe(5);
    expect([...WRITABLE_FIELDS].sort()).toEqual([
      "categ_id",
      "is_published",
      "public_categ_ids",
      "seller_ids",
      "supplier_taxes_id",
    ]);
  });

  it("prohibe los modelos que mueven stock", () => {
    for (const modelo of ["stock.quant", "stock.move", "stock.inventory"]) {
      expect(() => assertModelAllowed(modelo)).toThrow(/inventario/i);
    }
    expect(() => assertModelAllowed("product.template")).not.toThrow();
  });
});

describe("toOdooValues", () => {
  it("omite las claves ausentes en vez de mandarlas vacias", () => {
    expect(toOdooValues({ isPublished: true })).toEqual({ is_published: true });
  });

  it("traduce categoria interna a categ_id", () => {
    expect(toOdooValues({ categoryId: 7 })).toEqual({ categ_id: 7 });
  });

  it("usa el comando 6 (reemplazar todo) en los many2many", () => {
    expect(toOdooValues({ publicCategoryIds: [1, 2] })).toEqual({
      public_categ_ids: [[6, 0, [1, 2]]],
    });
    expect(toOdooValues({ purchaseTaxIds: [4] })).toEqual({
      supplier_taxes_id: [[6, 0, [4]]],
    });
  });

  it("reemplaza los proveedores existentes: limpia y crea", () => {
    expect(toOdooValues({ supplierPartnerId: 42 })).toEqual({
      seller_ids: [
        [5, 0, 0],
        [0, 0, { partner_id: 42 }],
      ],
    });
  });

  it("produce solo campos que la barrera acepta", () => {
    const valores = toOdooValues({
      categoryId: 1,
      publicCategoryIds: [2],
      isPublished: true,
      purchaseTaxIds: [3],
      supplierPartnerId: 4,
    });
    expect(() => assertWritable(valores)).not.toThrow();
  });
});
