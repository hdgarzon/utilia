import { describe, it, expect } from "vitest";
import { suggestLiquidationPrice, tramoDeAntiguedad, redondearCentenaArriba, TRAMOS_ANTIGUEDAD } from "./liquidation-pricing";

const sold = new Date("2026-01-01T00:00:00Z");

function producto(over: Partial<{ salePrice: number; cmp: number; rotationDays: number; lastSoldAt: Date | null }>) {
  return { salePrice: 10_000, cmp: 4_000, rotationDays: 45, lastSoldAt: sold, ...over };
}

describe("tramoDeAntiguedad", () => {
  it("clasifica por dias sin venta con los limites de cada tramo", () => {
    expect(tramoDeAntiguedad(31, sold)).toBe("31-90");
    expect(tramoDeAntiguedad(90, sold)).toBe("31-90");
    expect(tramoDeAntiguedad(91, sold)).toBe("91-180");
    expect(tramoDeAntiguedad(180, sold)).toBe("91-180");
    expect(tramoDeAntiguedad(181, sold)).toBe("181-365");
    expect(tramoDeAntiguedad(365, sold)).toBe("181-365");
    expect(tramoDeAntiguedad(366, sold)).toBe("365+");
  });

  it("nunca vendido cae en el tramo mas viejo aunque lleve pocos dias", () => {
    expect(tramoDeAntiguedad(40, null)).toBe("365+");
  });

  it("los tramos definidos cubren 31 dias en adelante sin huecos", () => {
    for (let i = 1; i < TRAMOS_ANTIGUEDAD.length; i++) {
      expect(TRAMOS_ANTIGUEDAD[i].desdeDias).toBe((TRAMOS_ANTIGUEDAD[i - 1].hastaDias ?? 0) + 1);
    }
    expect(TRAMOS_ANTIGUEDAD[0].desdeDias).toBe(31);
    expect(TRAMOS_ANTIGUEDAD.at(-1)?.hastaDias).toBeNull();
  });
});

describe("redondearCentenaArriba", () => {
  it("sube a la centena siguiente y deja las centenas exactas", () => {
    expect(redondearCentenaArriba(4_401)).toBe(4_500);
    expect(redondearCentenaArriba(4_450)).toBe(4_500);
    expect(redondearCentenaArriba(4_500)).toBe(4_500);
    expect(redondearCentenaArriba(0)).toBe(0);
  });
});

describe("suggestLiquidationPrice", () => {
  it("31-90 dias: sin descuento, precio normal sin tocar", () => {
    const r = suggestLiquidationPrice(producto({ salePrice: 1_250, cmp: 500, rotationDays: 60 }));
    expect(r).toEqual({ tramo: "31-90", descuentoPct: 0, precioSugerido: 1_250, margenPct: 60 });
  });

  it("31-90 dias con margen positivo", () => {
    const r = suggestLiquidationPrice(producto({ rotationDays: 60 }));
    expect(r.precioSugerido).toBe(10_000);
    expect(r.margenPct).toBe(60);
    expect(r.alerta).toBeUndefined();
  });

  it("91-180 dias: 20% de descuento", () => {
    const r = suggestLiquidationPrice(producto({ rotationDays: 120 }));
    expect(r.tramo).toBe("91-180");
    expect(r.precioSugerido).toBe(8_000);
    expect(r.descuentoPct).toBe(20);
    expect(r.margenPct).toBe(50);
  });

  it("181-365 dias: 35% de descuento", () => {
    const r = suggestLiquidationPrice(producto({ rotationDays: 200 }));
    expect(r.tramo).toBe("181-365");
    expect(r.precioSugerido).toBe(6_500);
    expect(r.descuentoPct).toBe(35);
  });

  it("mas de 365 dias: costo + 10% redondeado a la centena", () => {
    const r = suggestLiquidationPrice(producto({ rotationDays: 400, cmp: 4_230 }));
    expect(r.tramo).toBe("365+");
    // 4230 * 1.10 = 4653 -> 4700
    expect(r.precioSugerido).toBe(4_700);
    expect(r.descuentoPct).toBe(53);
    expect(r.margenPct).toBeCloseTo(10);
  });

  it("nunca vendido: costo + 10% aunque lleve pocos dias en el sistema", () => {
    const r = suggestLiquidationPrice(producto({ rotationDays: 50, lastSoldAt: null, cmp: 1_000 }));
    expect(r.tramo).toBe("365+");
    expect(r.precioSugerido).toBe(1_100);
  });

  it("redondea el precio con descuento a la centena hacia arriba", () => {
    // 10_990 * 0.8 = 8792 -> 8800
    const r = suggestLiquidationPrice(producto({ salePrice: 10_990, rotationDays: 120 }));
    expect(r.precioSugerido).toBe(8_800);
    expect(r.descuentoPct).toBeCloseTo(((10_990 - 8_800) / 10_990) * 100);
  });

  it("nunca baja del cmp: el piso se aplica antes de redondear", () => {
    // 35% de 10_000 = 6_500 < cmp 7_050 -> 7_050 -> 7_100
    const r = suggestLiquidationPrice(producto({ rotationDays: 300, cmp: 7_050 }));
    expect(r.precioSugerido).toBe(7_100);
    expect(r.precioSugerido).toBeGreaterThanOrEqual(7_050);
    expect(r.margenPct).toBeGreaterThan(0);
  });

  it("el remate nunca sale mas caro que el precio normal", () => {
    // cmp 9_500 * 1.10 = 10_450 -> 10_500 > precio normal 10_000
    const r = suggestLiquidationPrice(producto({ rotationDays: 400, cmp: 9_500 }));
    expect(r.precioSugerido).toBe(10_000);
    expect(r.descuentoPct).toBe(0);
  });

  it("alerta cuando el precio normal es 0", () => {
    const r = suggestLiquidationPrice(producto({ salePrice: 0, rotationDays: 200 }));
    expect(r.alerta).toBe("precio_invalido");
    expect(r.tramo).toBe("181-365");
    expect(r.descuentoPct).toBe(0);
    expect(r.precioSugerido).toBe(0);
    expect(r.margenPct).toBe(0);
  });

  it("alerta cuando el precio normal esta por debajo del cmp y no descuenta", () => {
    const r = suggestLiquidationPrice(producto({ salePrice: 3_000, cmp: 4_000, rotationDays: 400 }));
    expect(r.alerta).toBe("precio_invalido");
    expect(r.precioSugerido).toBe(3_000);
    expect(r.descuentoPct).toBe(0);
    expect(r.margenPct).toBeCloseTo(-33.33, 1);
  });

  it("precio igual al cmp no es alerta: se vende a costo + 10%", () => {
    const r = suggestLiquidationPrice(producto({ salePrice: 4_000, cmp: 4_000, rotationDays: 400 }));
    expect(r.alerta).toBeUndefined();
    expect(r.precioSugerido).toBe(4_000);
  });
});
