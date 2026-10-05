import { describe, it, expect } from "vitest";
import {
  addDays,
  colombiaDateTimeString,
  colombiaDayOf,
  colombiaDayStartInstant,
  colombiaDayString,
  daysBetween,
  daysInMonth,
  isoDay,
  monthStart,
  previousMonth,
} from "./timezone";

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

describe("calendario de fechas DATE", () => {
  it("cuenta los dias de cada mes, incluido febrero bisiesto", () => {
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
  });

  it("el mes anterior a enero es diciembre del año anterior", () => {
    expect(previousMonth(2027, 1)).toEqual({ year: 2026, month: 12 });
    expect(previousMonth(2026, 10)).toEqual({ year: 2026, month: 9 });
  });

  it("isoDay y addDays operan en UTC sin correr el dia", () => {
    const start = monthStart(2026, 10);
    expect(isoDay(start)).toBe("2026-10-01");
    expect(isoDay(addDays(start, 30))).toBe("2026-10-31");
    expect(daysBetween(start, addDays(start, 30))).toBe(30);
  });
});

describe("dia Colombia de un instante", () => {
  it("las 8:30pm en Colombia siguen siendo el mismo dia", () => {
    // 2026-09-08 20:30 Colombia = 2026-09-09 01:30 UTC.
    expect(isoDay(colombiaDayOf(new Date("2026-09-09T01:30:00.000Z")))).toBe("2026-09-08");
  });

  it("el inicio del dia de un sync a las 2pm es la medianoche Colombia (05:00 UTC)", () => {
    // Un sync manual a las 2pm debe hacer que el siguiente traiga el dia COMPLETO.
    const sync = new Date("2026-09-14T19:00:00.000Z"); // 2pm Colombia
    expect(colombiaDayStartInstant(sync).toISOString()).toBe("2026-09-14T05:00:00.000Z");
  });
});
