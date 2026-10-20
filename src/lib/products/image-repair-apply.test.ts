import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/odoo", () => ({ odooRpc: { executeKw: vi.fn(), searchRead: vi.fn() } }));
vi.mock("@/lib/odoo-write", () => ({ translateOdooError: (e: unknown) => String(e) }));
vi.mock("@/lib/analytics/abc", () => ({ getABCAnalysis: vi.fn() }));

import { applyImageRepairs, type ImageRepairDeps } from "./image-repair-apply";
import { analyzeImage } from "./image-repair";
import type { ImageRepairTarget } from "./image-repair-candidates";

async function target(templateId: number, original?: Buffer): Promise<ImageRepairTarget> {
  const producto = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#d02020" } }).png().toBuffer();
  const buf =
    original ??
    (await sharp({ create: { width: 600, height: 600, channels: 3, background: "#ffffff" } })
      .composite([{ input: producto, gravity: "center" }])
      .png()
      .toBuffer());
  return {
    templateId,
    name: `P${templateId}`,
    category: null,
    salePrice: 1,
    stockQty: 1,
    avgDailySales30d: 1,
    tier: "A",
    original: buf,
    analysis: await analyzeImage(buf).catch(() => ({ width: 0, height: 0, bordeBlanco: 0, ladoProducto: 0, ocupacion: 0 })),
  };
}

function deps(over: Partial<ImageRepairDeps> = {}) {
  const orden: string[] = [];
  const d: ImageRepairDeps = {
    backup: vi.fn(async (row) => {
      orden.push(`backup ${row.odooTemplateId}`);
    }),
    write: vi.fn(async (id) => {
      orden.push(`write ${id}`);
    }),
    ...over,
  };
  return { d, orden };
}

describe("applyImageRepairs", () => {
  it("respalda la original antes de escribir cada foto", async () => {
    const { d, orden } = deps();
    const t = await target(1);
    const r = await applyImageRepairs([t, await target(2)], "dueno@example.com", d);
    expect(r).toEqual({ written: 2, failed: [] });
    expect(orden).toEqual(["backup 1", "write 1", "backup 2", "write 2"]);
    expect(d.backup).toHaveBeenCalledWith(
      expect.objectContaining({ odooTemplateId: 1, imageBase64: t.original.toString("base64"), createdBy: "dueno@example.com" })
    );
  });

  it("si el respaldo falla no escribe nada mas", async () => {
    const { d } = deps({ backup: vi.fn().mockRejectedValue(new Error("db caida")) });
    const r = await applyImageRepairs([await target(1), await target(2)], null, d);
    expect(d.write).not.toHaveBeenCalled();
    expect(r.written).toBe(0);
    expect(r.failed.map((f) => f.templateId)).toEqual([1, 2]);
  });

  it("corta cuando Odoo no responde y sigue ante un rechazo de negocio", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("Odoo RPC error: producto archivado"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("fetch failed"));
    const { d } = deps({ write });
    const targets = [await target(1), await target(2), await target(3), await target(4)];
    const r2 = await applyImageRepairs(targets, null, d);
    expect(r2.written).toBe(1);
    expect(r2.failed.map((f) => f.templateId)).toEqual([1, 3, 4]);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("salta una foto que no se puede procesar sin respaldarla", async () => {
    const { d } = deps();
    const r = await applyImageRepairs([await target(1, Buffer.from("no es imagen")), await target(2)], null, d);
    expect(r.written).toBe(1);
    expect(r.failed).toEqual([{ templateId: 1, name: "P1", error: "No se pudo procesar la foto" }]);
    expect(d.backup).toHaveBeenCalledTimes(1);
  });
});
