import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { analyzeImage, needsRepair, repairImage, repairedSide, type ImageAnalysis } from "./image-repair";

/** Lienzo de `w`x`h` con un rectangulo rojo de `pw`x`ph` centrado. */
async function foto(w: number, h: number, pw: number, ph: number, fondo = "#ffffff"): Promise<Buffer> {
  const producto = await sharp({ create: { width: pw, height: ph, channels: 3, background: "#d02020" } })
    .png()
    .toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: fondo } })
    .composite([{ input: producto, gravity: "center" }])
    .png()
    .toBuffer();
}

function analisis(over: Partial<ImageAnalysis>): ImageAnalysis {
  return { width: 1000, height: 1000, bordeBlanco: 1, ladoProducto: 880, ocupacion: 0.88, ...over };
}

describe("analyzeImage", () => {
  it("mide el producto sin el margen blanco", async () => {
    const a = await analyzeImage(await foto(1920, 1080, 600, 400));
    expect(a.width).toBe(1920);
    expect(a.height).toBe(1080);
    expect(a.bordeBlanco).toBe(1);
    expect(a.ladoProducto).toBe(600);
    expect(a.ocupacion).toBeCloseTo(600 / 1920, 3);
  });

  it("detecta un fondo que no es blanco", async () => {
    const a = await analyzeImage(await foto(800, 800, 400, 400, "#808080"));
    expect(a.bordeBlanco).toBe(0);
  });
});

describe("needsRepair", () => {
  it("repara un producto chico sobre fondo blanco", () => {
    expect(needsRepair(analisis({ ocupacion: 0.5, ladoProducto: 500 }))).toBe(true);
  });

  it("repara una foto apaisada con fondo blanco aunque el producto la llene", () => {
    expect(needsRepair(analisis({ width: 1920, height: 1080, ocupacion: 0.95 }))).toBe(true);
  });

  it("no toca fotos con fondo de color o de ambiente", () => {
    expect(needsRepair(analisis({ bordeBlanco: 0.6, ocupacion: 0.4 }))).toBe(false);
  });

  it("no toca una foto cuadrada que el producto ya llena", () => {
    expect(needsRepair(analisis({ ocupacion: 0.9 }))).toBe(false);
  });

  it("no toca una imagen sin dimensiones", () => {
    expect(needsRepair(analisis({ width: 0, height: 0, ocupacion: 0 }))).toBe(false);
  });
});

describe("repairedSide", () => {
  it("deja el producto al 88 % del lienzo sin agrandarlo", () => {
    expect(repairedSide(880)).toBe(1000);
    expect(repairedSide(350)).toBe(398);
  });

  it("no pasa del tope de Odoo", () => {
    expect(repairedSide(1900)).toBe(1920);
  });
});

describe("repairImage", () => {
  it("devuelve un JPEG cuadrado con el producto centrado al 88 %", async () => {
    const r = await repairImage(await foto(1920, 1080, 600, 400));
    const buf = Buffer.from(r.base64, "base64");
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(682);
    expect(meta.height).toBe(682);
    expect(r.side).toBe(682);

    const a = await analyzeImage(buf);
    expect(a.ocupacion).toBeGreaterThan(0.86);
    expect(a.ocupacion).toBeLessThan(0.9);
  });

  it("es idempotente: la foto reparada ya no califica", async () => {
    const r = await repairImage(await foto(1250, 1120, 500, 700));
    const a = await analyzeImage(Buffer.from(r.base64, "base64"));
    expect(needsRepair(a)).toBe(false);
  });

  it("aplana la transparencia sobre blanco", async () => {
    const transparente = await sharp({
      create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({ create: { width: 100, height: 200, channels: 3, background: "#2050d0" } })
            .png()
            .toBuffer(),
          gravity: "center",
        },
      ])
      .png()
      .toBuffer();
    const r = await repairImage(transparente);
    const a = await analyzeImage(Buffer.from(r.base64, "base64"));
    // Sin aplanar, el fondo transparente saldria negro en el JPEG.
    expect(a.bordeBlanco).toBeGreaterThan(0.9);
    expect(r.side).toBe(repairedSide(200));
  });
});
