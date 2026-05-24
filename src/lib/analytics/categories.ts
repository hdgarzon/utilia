import { prisma } from "@/lib/prisma";

export interface CategoryStat {
  category: string; // "Sin categoría" cuando es null en BD
  rawCategory: string | null;
  productCount: number;
  totalStock: number;
  inventoryValue: number; // suma(stockQty * cmp)
  retailValue: number;    // suma(stockQty * salePrice) → valor potencial
  avgMarginPct: number;   // margen promedio ponderado por stock
  productsWithSales: number;
  criticalStockCount: number; // productos con 0 < daysOfStock < 7
  staleCount: number;          // productos con rotationDays > 30
  totalDailySales: number;     // suma de avgDailySales7d (volumen)
}

/**
 * Agrega ProductInsight por categoría usando SQL nativo para performance.
 * Convierte category=NULL en "Sin categoría" para que la UI no tenga gaps.
 */
export async function getCategoryStats(): Promise<CategoryStat[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      category: string | null;
      product_count: bigint;
      total_stock: number | null;
      inventory_value: number | null;
      retail_value: number | null;
      avg_margin_pct: number | null;
      with_sales: bigint;
      critical_count: bigint;
      stale_count: bigint;
      total_daily_sales: number | null;
    }>
  >`
    SELECT
      category,
      COUNT(*)::bigint                                       AS product_count,
      COALESCE(SUM("stockQty"), 0)                           AS total_stock,
      COALESCE(SUM("stockQty" * cmp), 0)                     AS inventory_value,
      COALESCE(SUM("stockQty" * "salePrice"), 0)             AS retail_value,
      CASE
        WHEN COALESCE(SUM("stockQty" * "salePrice"), 0) > 0
        THEN (
          SUM("stockQty" * ("salePrice" - cmp))
          / NULLIF(SUM("stockQty" * "salePrice"), 0)
        ) * 100
        ELSE 0
      END                                                    AS avg_margin_pct,
      COUNT(*) FILTER (WHERE "avgDailySales7d" > 0)::bigint  AS with_sales,
      COUNT(*) FILTER (
        WHERE "avgDailySales7d" > 0 AND "daysOfStock" > 0 AND "daysOfStock" < 7
      )::bigint                                              AS critical_count,
      COUNT(*) FILTER (WHERE "rotationDays" > 30)::bigint    AS stale_count,
      COALESCE(SUM("avgDailySales7d"), 0)                    AS total_daily_sales
    FROM "ProductInsight"
    GROUP BY category
    ORDER BY inventory_value DESC NULLS LAST
  `;

  return rows.map((r) => ({
    category: r.category ?? "Sin categoría",
    rawCategory: r.category,
    productCount: Number(r.product_count),
    totalStock: r.total_stock ?? 0,
    inventoryValue: r.inventory_value ?? 0,
    retailValue: r.retail_value ?? 0,
    avgMarginPct: r.avg_margin_pct ?? 0,
    productsWithSales: Number(r.with_sales),
    criticalStockCount: Number(r.critical_count),
    staleCount: Number(r.stale_count),
    totalDailySales: r.total_daily_sales ?? 0,
  }));
}
