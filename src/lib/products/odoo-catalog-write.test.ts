import { describe, it, expect, beforeEach, vi } from "vitest";

const { executeKw } = vi.hoisted(() => ({ executeKw: vi.fn() }));
vi.mock("@/lib/odoo", () => ({ odooRpc: { executeKw, searchRead: vi.fn() } }));
vi.mock("@/lib/odoo-write", () => ({ translateOdooError: (e: unknown) => String(e) }));

import { updateTemplates } from "./odoo-catalog-write";

// Cuerpo de bloque a proposito: si la arrow function devolviera el mock
// (retorno implicito de mockReset), Vitest la registraria como callback de
// limpieza y la invocaria sola despues de cada test. Es inofensivo mientras
// el mock quede en resolve/no-op, pero con un mockRejectedValue persistente
// esa llamada automatica dispara un rechazo sin capturar ajeno al test.
beforeEach(() => {
  executeKw.mockReset();
});

describe("updateTemplates", () => {
  it("no llama a Odoo si no hay ids", async () => {
    const r = await updateTemplates([], { isPublished: true });
    expect(r).toEqual({ ok: [], failed: [] });
    expect(executeKw).not.toHaveBeenCalled();
  });

  it("rechaza un patch vacio antes de salir a la red", async () => {
    await expect(updateTemplates([1], {})).rejects.toThrow(/sin cambios/i);
    expect(executeKw).not.toHaveBeenCalled();
  });

  it("escribe en lotes de 50", async () => {
    executeKw.mockResolvedValue(true);
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    const r = await updateTemplates(ids, { categoryId: 3 });
    expect(executeKw).toHaveBeenCalledTimes(3);
    expect(r.ok).toHaveLength(120);
    expect(r.failed).toEqual([]);
  });

  it("manda el modelo y los valores traducidos", async () => {
    executeKw.mockResolvedValue(true);
    await updateTemplates([7], { categoryId: 3 });
    const [modelo, metodo, args] = executeKw.mock.calls[0];
    expect(modelo).toBe("product.template");
    expect(metodo).toBe("write");
    expect(args).toEqual([[7], { categ_id: 3 }]);
  });

  it("aisla al culpable reintentando uno por uno cuando el lote falla", async () => {
    // 1a llamada: el lote de 3 lo rechaza Odoo. Luego uno por uno: 1 ok, 2 falla, 3 ok.
    executeKw
      .mockRejectedValueOnce(new Error("Odoo RPC error: lote invalido"))
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("Odoo RPC error: producto archivado"))
      .mockResolvedValueOnce(true);

    const r = await updateTemplates([1, 2, 3], { isPublished: true });
    expect(r.ok).toEqual([1, 3]);
    expect(r.failed).toEqual([{ id: 2, error: "Error: Odoo RPC error: producto archivado" }]);
    expect(executeKw).toHaveBeenCalledTimes(4);
  });

  it("ante un fallo de transporte corta en vez de repetir el timeout 50 veces", async () => {
    // Sin "Odoo RPC error" en el mensaje: es red caida, no rechazo de negocio.
    executeKw.mockRejectedValue(new Error("Odoo HTTP 502: Bad Gateway"));

    const r = await updateTemplates([1, 2, 3], { isPublished: true });
    // Un solo intento: NO reintenta uno por uno.
    expect(executeKw).toHaveBeenCalledTimes(1);
    expect(r.ok).toEqual([]);
    expect(r.failed.map((f) => f.id)).toEqual([1, 2, 3]);
  });

  it("un fallo de transporte no sigue con los lotes siguientes", async () => {
    executeKw
      .mockResolvedValueOnce(true) // lote 1 (ids 1..50) OK
      .mockRejectedValue(new Error("Odoo HTTP 502: Bad Gateway")); // lote 2 cae

    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    const r = await updateTemplates(ids, { categoryId: 3 });
    expect(executeKw).toHaveBeenCalledTimes(2); // no intenta el tercer lote
    expect(r.ok).toHaveLength(50);
    expect(r.failed).toHaveLength(70);
  });

  it("un patch sin ningun campo conocido se rechaza sin tocar Odoo", async () => {
    executeKw.mockResolvedValue(true);
    // @ts-expect-error se fuerza un patch invalido a proposito
    await expect(updateTemplates([1], { qty_available: 5 })).rejects.toThrow(/sin cambios/i);
    expect(executeKw).not.toHaveBeenCalled();
  });

  it("la barrera esta cableada: un campo prohibido traducido no llega a Odoo", async () => {
    // toOdooValues nunca produce un campo prohibido, asi que la unica forma de
    // comprobar que assertWritableOnUpdate esta REALMENTE en el camino es
    // interceptar la traduccion. Sin esta prueba, borrar la llamada a
    // assertWritableOnUpdate no rompe ningun test.
    executeKw.mockResolvedValue(true);
    const guard = await import("./write-guard");
    const spy = vi.spyOn(guard, "toOdooValues").mockReturnValue({ qty_available: 5 });
    try {
      await expect(updateTemplates([1], { isPublished: true })).rejects.toThrow(/no permitido/i);
      expect(executeKw).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("createTemplate", () => {
  it("crea y devuelve el id de Odoo", async () => {
    executeKw.mockResolvedValue(4242);
    const { createTemplate } = await import("./odoo-catalog-write");
    const id = await createTemplate(
      {
        name: "CUADERNO DEMO",
        productType: "consu",
        isStorable: true,
        qtyOnHand: 25,
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
      },
      null
    );
    expect(id).toBe(4242);
    const [modelo, metodo, args] = executeKw.mock.calls[0];
    expect(modelo).toBe("product.template");
    expect(metodo).toBe("create");
    // La cantidad a la mano NO viaja a Odoo, aunque la fila la traiga.
    expect(JSON.stringify(args)).not.toContain("qty_available");
    expect(JSON.stringify(args)).not.toContain("25");
  });

  it("la barrera esta cableada: un campo prohibido traducido no llega a Odoo", async () => {
    // Mismo motivo que la prueba equivalente de updateTemplates: toOdooCreateValues
    // nunca produce un campo prohibido, asi que la unica forma de comprobar que
    // assertWritableOnCreate esta REALMENTE en el camino de createTemplate es
    // interceptar la traduccion. Sin esta prueba, borrar la llamada a
    // assertWritableOnCreate no rompe ningun test (verificado a mano).
    executeKw.mockResolvedValue(4242);
    const { createTemplate } = await import("./odoo-catalog-write");
    const guard = await import("./write-guard");
    const spy = vi.spyOn(guard, "toOdooCreateValues").mockReturnValue({ qty_available: 5 });
    try {
      await expect(
        createTemplate(
          {
            name: "CUADERNO DEMO",
            productType: "consu",
            isStorable: true,
            qtyOnHand: null,
            salePrice: null,
            cost: null,
            purchaseTaxIds: [],
            categoryId: null,
            imageUrl: null,
            imageData: null,
            isPublished: false,
            publicCategoryIds: [],
            showAvailability: false,
            supplierPartnerId: null,
          },
          null
        )
      ).rejects.toThrow(/no permitido/i);
      expect(executeKw).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
