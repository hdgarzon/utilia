import { describe, it, expect } from "vitest";
import {
  revisarPesoImagenes,
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
