import { describe, it, expect, beforeEach, vi } from "vitest";

const { executeKw } = vi.hoisted(() => ({ executeKw: vi.fn() }));
vi.mock("@/lib/odoo", () => ({ odooRpc: { executeKw, searchRead: vi.fn() } }));
vi.mock("@/lib/odoo-write", () => ({ translateOdooError: (e: unknown) => String(e) }));

import { updateTemplates } from "./odoo-catalog-write";

beforeEach(() => executeKw.mockReset());

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
    // 1a llamada: el lote de 3 falla. Luego uno por uno: 1 ok, 2 falla, 3 ok.
    executeKw
      .mockRejectedValueOnce(new Error("lote invalido"))
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("producto archivado"))
      .mockResolvedValueOnce(true);

    const r = await updateTemplates([1, 2, 3], { isPublished: true });
    expect(r.ok).toEqual([1, 3]);
    expect(r.failed).toEqual([{ id: 2, error: "Error: producto archivado" }]);
    expect(executeKw).toHaveBeenCalledTimes(4);
  });

  it("nunca deja pasar un campo de inventario", async () => {
    executeKw.mockResolvedValue(true);
    // @ts-expect-error se fuerza un patch invalido a proposito
    await expect(updateTemplates([1], { qty_available: 5 })).rejects.toThrow(/sin cambios/i);
  });
});
