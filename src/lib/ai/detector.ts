/**
 * Detector de señales para el motor de recomendaciones IA.
 *
 * Esta capa NO usa LLMs — solo queries sobre Prisma. Identifica oportunidades
 * a partir de reglas heurísticas claras. El LLM solo se invoca después para
 * convertir las señales en texto accionable en español.
 *
 * Beneficio: si el LLM cae o se vuelve caro, el detector sigue produciendo
 * señales que la UI puede mostrar como recomendaciones "técnicas" sin copy.
 */

import { prisma } from "@/lib/prisma";

export type SignalType = "restock" | "stale" | "hot" | "low_margin" | "no_sales_high_stock";

export interface Signal {
  type: SignalType;
  priority: "high" | "medium" | "low";
  productId: string; // ProductInsight.id
  odooProductId: number;
  productName: string;
  // Datos crudos para que el LLM pueda redactar la recomendación
  facts: Record<string, string | number>;
  // Hash determinista (type:odooProductId) para deduplicación
  key: string;
}

/** Productos con baja cobertura de stock (<7 días) y rotación activa */
async function detectRestock(): Promise<Signal[]> {
  const products = await prisma.productInsight.findMany({
    where: {
      avgDailySales7d: { gt: 0 },
      daysOfStock: { gt: 0, lt: 7 },
    },
    orderBy: { daysOfStock: "asc" },
    take: 20,
  });
  return products.map((p) => ({
    type: "restock" as const,
    priority: p.daysOfStock < 3 ? "high" : "medium",
    productId: p.id,
    odooProductId: p.odooProductId,
    productName: p.name,
    key: `restock:${p.odooProductId}`,
    facts: {
      stockActual: p.stockQty,
      diasStock: Math.round(p.daysOfStock * 10) / 10,
      ventaPromedio7d: Math.round(p.avgDailySales7d * 100) / 100,
      precioVenta: p.salePrice,
      cantidadSugerida: Math.max(Math.ceil(p.avgDailySales7d * 21 - p.stockQty), 0),
    },
  }));
}

/** Productos sin rotación reciente (>30 días) con stock significativo */
async function detectStale(): Promise<Signal[]> {
  const products = await prisma.productInsight.findMany({
    where: {
      rotationDays: { gt: 30 },
      stockQty: { gt: 3 },
    },
    orderBy: { rotationDays: "desc" },
    take: 15,
  });
  return products.map((p) => ({
    type: "stale" as const,
    priority: p.rotationDays > 90 ? "high" : "medium",
    productId: p.id,
    odooProductId: p.odooProductId,
    productName: p.name,
    key: `stale:${p.odooProductId}`,
    facts: {
      diasSinVenta: p.rotationDays,
      stockActual: p.stockQty,
      precioVenta: p.salePrice,
      capitalInmovilizado: p.stockQty * p.cmp,
      descuentoSugerido: 20, // 20% de descuento como punto de partida
    },
  }));
}

/** Productos con margen bajo (<20%) — oportunidad de subir precio */
async function detectLowMargin(): Promise<Signal[]> {
  // Solo productos que se venden Y tienen CMP > 0 (datos confiables)
  const products = await prisma.productInsight.findMany({
    where: {
      avgDailySales7d: { gt: 0 },
      cmp: { gt: 0 },
      salePrice: { gt: 0 },
    },
    take: 100,
  });
  return products
    .map((p) => {
      const margin = ((p.salePrice - p.cmp) / p.salePrice) * 100;
      return { p, margin };
    })
    .filter(({ margin }) => margin > 0 && margin < 20)
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 10)
    .map(({ p, margin }) => ({
      type: "low_margin" as const,
      priority: margin < 10 ? "high" : "medium",
      productId: p.id,
      odooProductId: p.odooProductId,
      productName: p.name,
      key: `low_margin:${p.odooProductId}`,
      facts: {
        precioActual: p.salePrice,
        costoMedio: p.cmp,
        margenActual: Math.round(margin * 10) / 10,
        ventaDiaria: Math.round(p.avgDailySales7d * 100) / 100,
        precioSugerido: Math.ceil(p.cmp / 0.7), // 30% margen objetivo
      },
    }));
}

/** Productos top con stock OK — candidatos a promover en campaña */
async function detectHot(): Promise<Signal[]> {
  const products = await prisma.productInsight.findMany({
    where: {
      avgDailySales7d: { gt: 1 }, // al menos 1 unidad/día
      daysOfStock: { gte: 14 },   // tenemos stock para sostener una campaña
    },
    orderBy: { avgDailySales7d: "desc" },
    take: 5,
  });
  return products.map((p) => ({
    type: "hot" as const,
    priority: "low",
    productId: p.id,
    odooProductId: p.odooProductId,
    productName: p.name,
    key: `hot:${p.odooProductId}`,
    facts: {
      ventaDiaria: Math.round(p.avgDailySales7d * 100) / 100,
      stockActual: p.stockQty,
      diasStock: Math.round(p.daysOfStock),
      precioVenta: p.salePrice,
    },
  }));
}

/** Productos con mucho stock y cero ventas (capital muerto) */
async function detectNoSalesHighStock(): Promise<Signal[]> {
  const products = await prisma.productInsight.findMany({
    where: {
      avgDailySales7d: { equals: 0 },
      stockQty: { gt: 10 },
      cmp: { gt: 0 },
    },
    orderBy: { stockQty: "desc" },
    take: 10,
  });
  return products.map((p) => ({
    type: "no_sales_high_stock" as const,
    priority: "medium",
    productId: p.id,
    odooProductId: p.odooProductId,
    productName: p.name,
    key: `no_sales_high_stock:${p.odooProductId}`,
    facts: {
      stockActual: p.stockQty,
      costoMedio: p.cmp,
      capitalInmovilizado: p.stockQty * p.cmp,
      precioVenta: p.salePrice,
    },
  }));
}

export async function detectAllSignals(): Promise<Signal[]> {
  const [restock, stale, lowMargin, hot, noSales] = await Promise.all([
    detectRestock(),
    detectStale(),
    detectLowMargin(),
    detectHot(),
    detectNoSalesHighStock(),
  ]);
  // Cap total para no saturar el LLM
  return [...restock, ...stale, ...lowMargin, ...hot, ...noSales].slice(0, 40);
}
