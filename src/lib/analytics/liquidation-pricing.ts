import type { DeadStockProduct } from "./dead-stock";

/**
 * Precio de remate por tramo de antiguedad.
 *
 * El plan de remate (octubre a enero) fija el descuento segun los dias sin
 * venta del producto. Los tramos son los del negocio, no una curva: un
 * producto que lleva mas de un año sin venderse, o que nunca vendio, sale a
 * costo mas un 10%, redondeado a la centena hacia arriba. Ningun precio de
 * remate baja del CMP.
 *
 * Los productos con precio invalido en Odoo (precio 0 o por debajo del CMP)
 * no entran al descuento automatico: se marcan para revisar el precio.
 */

export type TramoAntiguedad = "31-90" | "91-180" | "181-365" | "365+";

export interface TramoDef {
  clave: TramoAntiguedad;
  etiqueta: string;
  /** Dias sin venta desde los que aplica (inclusive). */
  desdeDias: number;
  /** Dias sin venta hasta los que aplica (inclusive); null = sin tope. */
  hastaDias: number | null;
  /** Descuento sobre el precio normal; null = se vende a costo + recargo. */
  descuentoPct: number | null;
}

export const TRAMOS_ANTIGUEDAD: readonly TramoDef[] = [
  { clave: "31-90", etiqueta: "31-90 dias", desdeDias: 31, hastaDias: 90, descuentoPct: 0 },
  { clave: "91-180", etiqueta: "91-180 dias", desdeDias: 91, hastaDias: 180, descuentoPct: 20 },
  { clave: "181-365", etiqueta: "181-365 dias", desdeDias: 181, hastaDias: 365, descuentoPct: 35 },
  { clave: "365+", etiqueta: "Mas de 1 año / nunca vendido", desdeDias: 366, hastaDias: null, descuentoPct: null },
];

/** Recargo sobre el CMP para el tramo mas viejo: se recupera el costo y un poco mas. */
export const RECARGO_SOBRE_COSTO_PCT = 10;

/** Los precios de remate se redondean hacia arriba a la centena. */
export const REDONDEO_CENTENA = 100;

export const ALERTA_PRECIO_INVALIDO = "precio_invalido" as const;

export interface PrecioRemate {
  tramo: TramoAntiguedad;
  descuentoPct: number;
  precioSugerido: number;
  /** Margen resultante sobre el precio sugerido: (precio - cmp) / precio. */
  margenPct: number;
  alerta?: typeof ALERTA_PRECIO_INVALIDO;
}

export function tramoDeAntiguedad(rotationDays: number, lastSoldAt: Date | null): TramoAntiguedad {
  if (lastSoldAt === null) return "365+";
  for (const t of TRAMOS_ANTIGUEDAD) {
    if (rotationDays <= (t.hastaDias ?? Infinity)) return t.clave;
  }
  return "365+";
}

export function tramoDef(clave: TramoAntiguedad): TramoDef {
  return TRAMOS_ANTIGUEDAD.find((t) => t.clave === clave)!;
}

export function redondearCentenaArriba(valor: number): number {
  return Math.ceil(valor / REDONDEO_CENTENA) * REDONDEO_CENTENA;
}

function margen(precio: number, cmp: number): number {
  return precio > 0 ? ((precio - cmp) / precio) * 100 : 0;
}

export function suggestLiquidationPrice(
  p: Pick<DeadStockProduct, "salePrice" | "cmp" | "rotationDays" | "lastSoldAt">,
): PrecioRemate {
  const tramo = tramoDeAntiguedad(p.rotationDays, p.lastSoldAt);
  const { salePrice, cmp } = p;

  // Precio de carga invalido: no se descuenta nada, se revisa en Odoo.
  if (salePrice <= 0 || salePrice < cmp) {
    return { tramo, descuentoPct: 0, precioSugerido: salePrice, margenPct: margen(salePrice, cmp), alerta: ALERTA_PRECIO_INVALIDO };
  }

  const def = tramoDef(tramo);

  // Sin descuento: el precio normal se deja como esta, sin redondear.
  if (def.descuentoPct === 0) {
    return { tramo, descuentoPct: 0, precioSugerido: salePrice, margenPct: margen(salePrice, cmp) };
  }

  const base = def.descuentoPct === null ? cmp * (1 + RECARGO_SOBRE_COSTO_PCT / 100) : salePrice * (1 - def.descuentoPct / 100);

  // Piso en el CMP y redondeo a la centena hacia arriba; el remate nunca
  // sale mas caro que el precio normal.
  const precioSugerido = Math.min(redondearCentenaArriba(Math.max(base, cmp)), salePrice);
  const descuentoPct = salePrice > 0 ? ((salePrice - precioSugerido) / salePrice) * 100 : 0;

  return { tramo, descuentoPct, precioSugerido, margenPct: margen(precioSugerido, cmp) };
}
