import { describe, it, expect } from "vitest";
import { colombiaDayString, colombiaDateTimeString } from "./timezone";

/**
 * El caso que este modulo existe para evitar: el servidor corre en UTC, y
 * despues de las 7pm Colombia `new Date()` ya apunta al dia siguiente.
 */
describe("colombiaDateTimeString", () => {
  it("una carga de las 8pm en Colombia no salta al dia siguiente", () => {
    // 2026-09-08 20:30 Colombia = 2026-09-09 01:30 UTC.
    const utc = new Date("2026-09-09T01:30:00.000Z");
    expect(colombiaDateTimeString(utc)).toBe("2026-09-08 20:30");
    expect(colombiaDayString(utc)).toBe("2026-09-08");
  });

  it("mediodia se muestra tal cual", () => {
    // 2026-09-08 12:00 Colombia = 17:00 UTC.
    expect(colombiaDateTimeString(new Date("2026-09-08T17:00:00.000Z"))).toBe("2026-09-08 12:00");
  });

  it("rellena con cero la hora y el minuto de un digito", () => {
    // 2026-09-08 03:05 Colombia = 08:05 UTC.
    expect(colombiaDateTimeString(new Date("2026-09-08T08:05:00.000Z"))).toBe("2026-09-08 03:05");
  });

  it("medianoche Colombia sigue siendo el mismo dia", () => {
    // 2026-09-08 00:00 Colombia = 05:00 UTC.
    expect(colombiaDateTimeString(new Date("2026-09-08T05:00:00.000Z"))).toBe("2026-09-08 00:00");
  });
});
