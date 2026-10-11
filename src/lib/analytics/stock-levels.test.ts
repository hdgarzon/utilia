import { describe, it, expect } from "vitest";
import { computeStockLevels } from "./stock-levels";

const base = { demandStdDev: 0, rotationDays: 3, category: "PIÑATERÍA" };

describe("computeStockLevels", () => {
  it("repone un producto que vende todos los meses aunque no haya vendido esta semana", () => {
    // ~19 unidades al mes, ninguna en los ultimos 7 dias: con la ventana de 7
    // dias quedaba en minimo 0 y no aparecia en el plan.
    const l = computeStockLevels({ ...base, avgDailySales30d: 0.63, rotationDays: 11 }, 4);
    expect(l.minStock).toBe(3); // ceil(0,63 x 4)
    expect(l.maxStock).toBe(16); // ceil(0,63 x 25)
  });

  it("no repone lo que no vendio en 30 dias, servicios ni lo que supera 45 dias sin venta", () => {
    expect(computeStockLevels({ ...base, avgDailySales30d: 0 }, 4).minStock).toBe(0);
    expect(computeStockLevels({ ...base, avgDailySales30d: 1, category: "SERVICIOS" }, 4).minStock).toBe(0);
    expect(computeStockLevels({ ...base, avgDailySales30d: 1, rotationDays: 46 }, 4).minStock).toBe(0);
  });

  it("suma el stock de seguridad y aplica el factor de temporada a la velocidad", () => {
    const l = computeStockLevels({ ...base, avgDailySales30d: 1, demandStdDev: 2 }, 4, 21, 1.5);
    expect(l.safetyStock).toBe(Math.ceil(1.65 * 2 * 2)); // 7
    expect(l.minStock).toBe(6 + 7);
    expect(l.maxStock).toBe(Math.ceil(1.5 * 25) + 7);
  });
});
