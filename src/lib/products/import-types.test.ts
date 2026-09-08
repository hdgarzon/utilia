import { describe, it, expect } from "vitest";
import {
  revisarPesoImagenes,
  impuestoPorDefecto,
  defaultsDeFila,
  filaVacia,
  type ImportRowInput,
  MAX_IMAGE_PAYLOAD_BYTES,
  MAX_IMAGE_BASE64_BYTES,
  MAX_IMAGENES_ADJUNTAS,
  MAX_ACTION_BODY_BYTES,
  MAX_ROWS_PER_BATCH,
} from "./import-types";

/** Una fila con una foto adjunta del tamaño pedido. */
function conFoto(bytes: number) {
  return { imageData: "x".repeat(bytes) };
}

// Nombres reales del catalogo de la tienda: hay varios que contienen "19" y
// "VAT" sin ser el IVA de compra.
const IMPUESTOS = [
  { id: 1, name: "0% EXC VAT" },
  { id: 2, name: "15% RteVAT 19%" },
  { id: 3, name: "19% VAT" },
  { id: 4, name: "5% VAT" },
];

describe("impuestoPorDefecto", () => {
  it("encuentra el IVA del 19 % por nombre exacto", () => {
    expect(impuestoPorDefecto(IMPUESTOS)).toEqual([3]);
  });

  it("no se deja confundir por otro impuesto que mencione 19 y VAT", () => {
    // "15% RteVAT 19%" es retencion, no el IVA de compra. Un emparejamiento
    // laxo (contiene "19" y "vat") lo escogeria y le pondria retencion a
    // todos los productos cargados.
    expect(impuestoPorDefecto(IMPUESTOS)).not.toContain(2);
  });

  it("sin IVA en el catalogo, la fila nace sin impuesto en vez de adivinar", () => {
    expect(impuestoPorDefecto([{ id: 9, name: "0% EXEMPT" }])).toEqual([]);
    expect(impuestoPorDefecto([])).toEqual([]);
  });

  it("el id se resuelve contra el catalogo, nunca se escribe fijo", () => {
    // La misma tienda en otra instancia de Odoo tiene otro id para el IVA.
    expect(impuestoPorDefecto([{ id: 77, name: "19% VAT" }])).toEqual([77]);
  });
});

describe("defaultsDeFila y filaVacia", () => {
  it("una fila nueva nace con IVA, publicada, con disponibilidad y en la caja", () => {
    const f = filaVacia(0, defaultsDeFila({ purchaseTaxes: IMPUESTOS }));
    expect(f.purchaseTaxIds).toEqual([3]);
    expect(f.isPublished).toBe(true);
    expect(f.showAvailability).toBe(true);
    expect(f.availableInPos).toBe(true);
  });

  it("sin defaults sigue naciendo en blanco, como antes", () => {
    const f = filaVacia(0);
    expect(f.purchaseTaxIds).toEqual([]);
    expect(f.isPublished).toBe(false);
    expect(f.showAvailability).toBe(false);
    expect(f.availableInPos).toBe(false);
  });

  it("los defaults no pueden pisar el indice ni la identidad de la fila", () => {
    // Un `defaults` con rowIndex pegado desordenaria la hoja entera, y un
    // clientId repetido rompe las keys de React: dos filas con la misma key
    // comparten el estado interno de sus celdas.
    const sucio = { rowIndex: 99, clientId: "fijo" } as Partial<ImportRowInput>;
    const a = filaVacia(4, sucio);
    const b = filaVacia(5, sucio);
    expect(a.rowIndex).toBe(4);
    expect(b.rowIndex).toBe(5);
    expect(a.clientId).not.toBe(b.clientId);
  });
});

describe("revisarPesoImagenes", () => {
  it("una hoja sin fotos siempre cabe", () => {
    const filas = Array.from({ length: MAX_ROWS_PER_BATCH }, () => ({ imageData: null }));
    expect(revisarPesoImagenes(filas)).toBeNull();
  });

  it("las fotos al tope que promete el limite caben de verdad", () => {
    const filas = Array.from({ length: MAX_IMAGENES_ADJUNTAS }, () =>
      conFoto(MAX_IMAGE_BASE64_BYTES)
    );
    expect(revisarPesoImagenes(filas)).toBeNull();
  });

  it("una foto mas que el tope no cabe", () => {
    const filas = Array.from({ length: MAX_IMAGENES_ADJUNTAS + 1 }, () =>
      conFoto(MAX_IMAGE_BASE64_BYTES)
    );
    expect(revisarPesoImagenes(filas)).not.toBeNull();
  });

  it("doscientas filas con foto NO caben, y el aviso dice por que", () => {
    // El caso que el tope viejo no cubria: `bodySizeLimit` estaba calculado
    // suponiendo ocho fotos, pero nada impedia adjuntarle una a cada fila.
    // El envio se iba a ~100 MB, lo cortaba la plataforma y el navegador
    // mostraba "revisa tu conexion".
    const filas = Array.from({ length: MAX_ROWS_PER_BATCH }, () => conFoto(MAX_IMAGE_BASE64_BYTES));
    const aviso = revisarPesoImagenes(filas);
    expect(aviso).toContain("200 fotos");
    expect(aviso).toMatch(/divide la lista en tandas/i);
    // Y no culpa a la conexion.
    expect(aviso).not.toMatch(/conexi/i);
  });

  it("los links no pesan: se descargan en el servidor", () => {
    const filas = Array.from({ length: MAX_ROWS_PER_BATCH }, () => ({ imageData: null }));
    expect(revisarPesoImagenes(filas)).toBeNull();
  });

  it("el body deja margen real para el texto de la hoja", () => {
    // El tope viejo eran 4.000.000 escritos a mano: exactamente ocho fotos y
    // cero bytes para las 200 filas de texto, pese a que el comentario decia
    // lo contrario. El margen tiene que alcanzar para la hoja llena.
    const margen = MAX_ACTION_BODY_BYTES - MAX_IMAGE_PAYLOAD_BYTES;
    const textoPeorCaso = MAX_ROWS_PER_BATCH * 1000; // ~1 KB de JSON por fila
    expect(margen).toBeGreaterThanOrEqual(textoPeorCaso);
  });

  it("el body queda bajo el techo duro de Vercel para funciones serverless", () => {
    // 4,5 MB, y no se puede subir desde configuracion. Si alguien sube el
    // tope de aqui por encima de eso, la carga masiva deja de funcionar en
    // produccion y en local no se nota.
    expect(MAX_ACTION_BODY_BYTES).toBeLessThan(4_500_000);
  });
});
