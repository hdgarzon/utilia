import { prisma } from "@/lib/prisma";

export interface OppProduct {
  key: string;
  name: string;
  category: string | null;
  velocity: number;       // unidades/día (ventana 7d)
  marginPct: number;
  salePrice: number;
  stockQty: number;
  inventoryValue: number; // stock × cmp
  rotationDays: number;
}

export interface Opportunities {
  stars: OppProduct[];        // venden bien + buen margen → impulsar / no quedar sin stock
  lowMargin: OppProduct[];    // venden pero margen bajo → subir precio
  deadStock: OppProduct[];    // con stock pero sin venta en 30d → liquidar
  deadStockTotal: number;     // capital total inmovilizado
  deadStockCount: number;     // cuántos productos componen ese capital muerto
  starsRevenue: number;       // ingreso mensual proyectado de las estrellas
}

/**
 * Detecta oportunidades accionables a partir de ProductInsight, consolidando
 * variantes por template (COALESCE(templateId, productId)). Tres frentes:
 *   - Estrella: rotación > 0.3/día y margen ≥ 30% → asegurar stock, dar visibilidad.
 *   - Margen bajo: rotación > 0.3/día y margen < 15% → revisar precio.
 *   - Capital muerto: stock con valor y sin rotación → liquidar para liberar caja.
 */
export async function getOpportunities(): Promise<Opportunities> {
  const groups = await prisma.$queryRaw<
    Array<{
      k: number;
      name: string | null;
      category: string | null;
      vel: number | null;
      stock: number | null;
      inv_value: number | null;
      w_price_num: number | null;
      w_cmp_num: number | null;
      rot: number | null;
    }>
  >`
    SELECT
      COALESCE("odooTemplateId", "odooProductId")        AS k,
      MIN(COALESCE("templateName", name))                AS name,
      MIN(category)                                      AS category,
      COALESCE(SUM("avgDailySales7d"), 0)                AS vel,
      COALESCE(SUM("stockQty"), 0)                       AS stock,
      COALESCE(SUM("stockQty" * cmp), 0)                 AS inv_value,
      COALESCE(SUM("avgDailySales7d" * "salePrice"), 0)  AS w_price_num,
      COALESCE(SUM("avgDailySales7d" * cmp), 0)          AS w_cmp_num,
      COALESCE(MAX("rotationDays"), 0)                   AS rot
    FROM "ProductInsight"
    GROUP BY k
  `;

  const enriched = groups.map((g) => {
    const velocity = g.vel ?? 0;
    const stockQty = g.stock ?? 0;
    const inventoryValue = g.inv_value ?? 0;
    // Precio y costo efectivos: promedio ponderado por velocidad.
    const salePrice = velocity > 0 ? (g.w_price_num ?? 0) / velocity : 0;
    const cmp = velocity > 0 ? (g.w_cmp_num ?? 0) / velocity : 0;
    const marginPct = salePrice > 0 ? ((salePrice - cmp) / salePrice) * 100 : 0;
    return {
      key: String(g.k),
      name: g.name ?? "Sin nombre",
      category: g.category,
      velocity,
      marginPct,
      salePrice,
      cmp,
      stockQty,
      inventoryValue,
      rotationDays: g.rot ?? 0,
    };
  });

  const stars = enriched
    .filter((p) => p.velocity > 0.3 && p.salePrice > 0 && p.marginPct >= 30)
    .sort((a, b) => b.velocity * (b.salePrice - b.cmp) - a.velocity * (a.salePrice - a.cmp))
    .slice(0, 8);

  const lowMargin = enriched
    .filter((p) => p.velocity > 0.3 && p.salePrice > 0 && p.cmp > 0 && p.marginPct < 15)
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 8);

  const deadAll = enriched.filter((p) => p.velocity === 0 && p.stockQty > 0 && p.inventoryValue > 0);
  const deadStock = [...deadAll].sort((a, b) => b.inventoryValue - a.inventoryValue).slice(0, 8);
  const deadStockTotal = deadAll.reduce((s, p) => s + p.inventoryValue, 0);
  const starsRevenue = stars.reduce((s, p) => s + p.velocity * p.salePrice * 30, 0);

  const strip = ({ cmp: _cmp, ...rest }: (typeof enriched)[number]): OppProduct => rest;
  return {
    stars: stars.map(strip),
    lowMargin: lowMargin.map(strip),
    deadStock: deadStock.map(strip),
    deadStockTotal,
    deadStockCount: deadAll.length,
    starsRevenue,
  };
}
