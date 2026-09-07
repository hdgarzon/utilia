import { describe, it, expect } from "vitest";
import {
  assertWritableOnUpdate,
  assertWritableOnCreate,
  assertModelAllowed,
  toOdooValues,
  toOdooCreateValues,
  UPDATE_FIELDS,
  CREATE_FIELDS,
} from "./write-guard";
import type { ProductCreateInput } from "./import-types";

const CAMPOS_INVENTARIO = ["qty_available", "inventory_quantity", "free_qty"];

describe("barrera de inventario", () => {
  it("ninguna de las dos listas admite un campo de cantidad", () => {
    for (const campo of CAMPOS_INVENTARIO) {
      expect(UPDATE_FIELDS.has(campo)).toBe(false);
      expect(CREATE_FIELDS.has(campo)).toBe(false);
      expect(() => assertWritableOnUpdate({ [campo]: 10 })).toThrow(/no permitido/i);
      expect(() => assertWritableOnCreate({ [campo]: 10 })).toThrow(/no permitido/i);
    }
  });

  it("rechaza un campo desconocido aunque venga junto a uno valido", () => {
    expect(() => assertWritableOnUpdate({ categ_id: 3, qty_available: 10 })).toThrow(/qty_available/);
    expect(() => assertWritableOnCreate({ name: "x", free_qty: 1 })).toThrow(/free_qty/);
  });

  it("prohibe los modelos que mueven stock", () => {
    for (const modelo of ["stock.quant", "stock.move", "stock.inventory"]) {
      expect(() => assertModelAllowed(modelo)).toThrow(/inventario/i);
    }
    expect(() => assertModelAllowed("product.template")).not.toThrow();
  });
});

describe("el costo y el precio solo se escriben al crear", () => {
  it("standard_price se acepta al crear y se rechaza al actualizar", () => {
    expect(() => assertWritableOnCreate({ standard_price: 500 })).not.toThrow();
    expect(() => assertWritableOnUpdate({ standard_price: 500 })).toThrow(/no permitido/i);
  });

  it("list_price se acepta al crear y se rechaza al actualizar", () => {
    expect(() => assertWritableOnCreate({ list_price: 900 })).not.toThrow();
    expect(() => assertWritableOnUpdate({ list_price: 900 })).toThrow(/no permitido/i);
  });

  it("is_storable se acepta al crear y se rechaza al actualizar", () => {
    expect(() => assertWritableOnCreate({ is_storable: true })).not.toThrow();
    expect(() => assertWritableOnUpdate({ is_storable: true })).toThrow(/no permitido/i);
  });
});

describe("listas fijadas", () => {
  it("la lista de actualizacion son exactamente los cinco campos del catalogo", () => {
    expect(UPDATE_FIELDS.size).toBe(5);
    expect([...UPDATE_FIELDS].sort()).toEqual([
      "categ_id",
      "is_published",
      "public_categ_ids",
      "seller_ids",
      "supplier_taxes_id",
    ]);
  });

  it("la lista de creacion son esos cinco mas los siete de alta", () => {
    expect(CREATE_FIELDS.size).toBe(12);
    expect([...CREATE_FIELDS].sort()).toEqual([
      "categ_id",
      "image_1920",
      "is_published",
      "is_storable",
      "list_price",
      "name",
      "public_categ_ids",
      "seller_ids",
      "show_availability",
      "standard_price",
      "supplier_taxes_id",
      "type",
    ]);
  });

  it("todo lo de actualizacion tambien se puede crear", () => {
    for (const campo of UPDATE_FIELDS) expect(CREATE_FIELDS.has(campo)).toBe(true);
  });
});

function fila(over: Partial<ProductCreateInput> = {}): ProductCreateInput {
  return {
    name: "CUADERNO DEMO",
    productType: "consu",
    isStorable: true,
    qtyOnHand: null,
    salePrice: 1000,
    cost: 600,
    purchaseTaxIds: [],
    categoryId: null,
    imageUrl: null,
    imageData: null,
    isPublished: false,
    publicCategoryIds: [],
    showAvailability: false,
    supplierPartnerId: null,
    ...over,
  };
}

describe("toOdooCreateValues", () => {
  it("traduce lo minimo", () => {
    expect(toOdooCreateValues(fila({ salePrice: null, cost: null }), null)).toEqual({
      name: "CUADERNO DEMO",
      type: "consu",
      is_storable: true,
      is_published: false,
      show_availability: false,
    });
  });

  it("NUNCA emite la cantidad a la mano", () => {
    const v = toOdooCreateValues(fila({ qtyOnHand: 25 }), null);
    expect(v).not.toHaveProperty("qty_available");
    expect(v).not.toHaveProperty("inventory_quantity");
    expect(JSON.stringify(v)).not.toContain("25");
  });

  it("manda precio y costo cuando vienen", () => {
    const v = toOdooCreateValues(fila({ salePrice: 1000, cost: 600 }), null);
    expect(v.list_price).toBe(1000);
    expect(v.standard_price).toBe(600);
  });

  it("usa el comando 6 en los many2many", () => {
    const v = toOdooCreateValues(fila({ purchaseTaxIds: [20], publicCategoryIds: [10] }), null);
    expect(v.supplier_taxes_id).toEqual([[6, 0, [20]]]);
    expect(v.public_categ_ids).toEqual([[6, 0, [10]]]);
  });

  it("crea el proveedor con el comando 0", () => {
    const v = toOdooCreateValues(fila({ supplierPartnerId: 30 }), null);
    expect(v.seller_ids).toEqual([[0, 0, { partner_id: 30 }]]);
  });

  it("adjunta la imagen cuando la hay", () => {
    expect(toOdooCreateValues(fila(), "QUJD").image_1920).toBe("QUJD");
    expect(toOdooCreateValues(fila(), null)).not.toHaveProperty("image_1920");
  });

  it("produce solo campos que la barrera de creacion acepta", () => {
    const v = toOdooCreateValues(
      fila({ categoryId: 1, purchaseTaxIds: [20], publicCategoryIds: [10], supplierPartnerId: 30, qtyOnHand: 9 }),
      "QUJD"
    );
    expect(() => assertWritableOnCreate(v)).not.toThrow();
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
    expect(() => assertWritableOnUpdate(valores)).not.toThrow();
  });
});
