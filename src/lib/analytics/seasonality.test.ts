import { describe, it, expect } from "vitest";
import { seasonalFactorFor, type SeasonalIndex } from "./seasonality";

function idx(index: number, years: number): SeasonalIndex {
  return { category: "PIÑATERÍA", fortnight: "12-2a", index, years, avgDailyRevenue: 0 };
}

describe("seasonalFactorFor", () => {
  it("sin indice de alguna de las dos quincenas no ajusta", () => {
    expect(seasonalFactorFor(null, idx(2, 1))).toBe(1);
    expect(seasonalFactorFor(idx(1, 1), null)).toBe(1);
    expect(seasonalFactorFor(idx(0, 1), idx(2, 1))).toBe(1);
  });

  it("con un año respaldando el dato, aplica la mitad del cambio (en escala logaritmica)", () => {
    // cociente crudo 2,25 -> raiz -> 1,5
    expect(seasonalFactorFor(idx(1, 1), idx(2.25, 1))).toBeCloseTo(1.5, 10);
    // y simetrico hacia abajo: 0,64 -> 0,8
    expect(seasonalFactorFor(idx(1, 1), idx(0.64, 1))).toBeCloseTo(0.8, 10);
  });

  it("con dos años confia mas: dos tercios del cambio", () => {
    // 1,728 = 1,2^3 -> 1,2^2 = 1,44
    expect(seasonalFactorFor(idx(1, 2), idx(1.728, 2))).toBeCloseTo(1.44, 10);
  });

  it("usa los años de la quincena menos respaldada", () => {
    expect(seasonalFactorFor(idx(1, 3), idx(2.25, 1))).toBeCloseTo(1.5, 10);
  });

  it("mantiene los topes de 0,5 y 2,5 despues de encoger", () => {
    expect(seasonalFactorFor(idx(1, 1), idx(16, 1))).toBe(2.5);
    expect(seasonalFactorFor(idx(1, 1), idx(1 / 16, 1))).toBe(0.5);
  });
});
