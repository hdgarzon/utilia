import { prisma } from "@/lib/prisma";

export interface CategoryProductRow {
  id: string;
  odooProductId: number;
  name: string;
  stockQty: number;
  cmp: number;
  salePrice: number;
  marginPct: number;
  inventoryValue: number;
  avgDailySales7d: number;
  daysOfStock: number;
  rotationDays: number;
}

export interface CategoryDetail {
  category: string;
  rawCategory: string | null;
  totals: {
    productCount: number;
    activeProducts: number;
    inventoryValue: number;
    retailValue: number;
    avgMarginPct: number;
    totalDailySales: number;
  };
  topByVelocity: CategoryProductRow[];
  topByValue: CategoryProductRow[];
  criticalStock: CategoryProductRow[];
  stale: CategoryProductRow[];
  noMargin: CategoryProductRow[]; // productos con margen <15% o negativo
}

function mapProduct(p: {
  id: string;
  odooProductId: number;
  name: string;
  stockQty: number;
  cmp: number;
  salePrice: number;
  avgDailySales7d: number;
  daysOfStock: number;
  rotationDays: number;
}): CategoryProductRow {
  const marginPct = p.salePrice > 0 ? ((p.salePrice - p.cmp) / p.salePrice) * 100 : 0;
  return {
    id: p.id,
    odooProductId: p.odooProductId,
    name: p.name,
    stockQty: p.stockQty,
    cmp: p.cmp,
    salePrice: p.salePrice,
    marginPct,
    inventoryValue: p.stockQty * p.cmp,
    avgDailySales7d: p.avgDailySales7d,
    daysOfStock: p.daysOfStock,
    rotationDays: p.rotationDays,
  };
}

/**
 * Devuelve drill-down completo para una categoría. La búsqueda es case-
 * sensitive porque las categorías de Odoo vienen normalizadas en upper.
 * `null` para representar "Sin categoría" (productos sin categ_id).
 */
export async function getCategoryDetail(rawCategory: string | null): Promise<CategoryDetail | null> {
  const where = rawCategory === null ? { category: null } : { category: rawCategory };
  const allProducts = await prisma.productInsight.findMany({
    where,
    select: {
      id: true,
      odooProductId: true,
      name: true,
      stockQty: true,
      cmp: true,
      salePrice: true,
      avgDailySales7d: true,
      daysOfStock: true,
      rotationDays: true,
    },
  });

  if (allProducts.length === 0) return null;

  const rows = allProducts.map(mapProduct);
  const inventoryValue = rows.reduce((s, p) => s + p.inventoryValue, 0);
  const retailValue = rows.reduce((s, p) => s + p.stockQty * p.salePrice, 0);
  const totalDailySales = rows.reduce((s, p) => s + p.avgDailySales7d, 0);
  const activeProducts = rows.filter((p) => p.avgDailySales7d > 0).length;
  // Margen ponderado por valor retail
  const totalRetailSpread = rows.reduce((s, p) => s + p.stockQty * (p.salePrice - p.cmp), 0);
  const avgMarginPct = retailValue > 0 ? (totalRetailSpread / retailValue) * 100 : 0;

  const topByVelocity = [...rows]
    .filter((p) => p.avgDailySales7d > 0)
    .sort((a, b) => b.avgDailySales7d - a.avgDailySales7d)
    .slice(0, 10);

  const topByValue = [...rows]
    .filter((p) => p.inventoryValue > 0)
    .sort((a, b) => b.inventoryValue - a.inventoryValue)
    .slice(0, 10);

  const criticalStock = [...rows]
    .filter((p) => p.avgDailySales7d > 0 && p.daysOfStock > 0 && p.daysOfStock < 7)
    .sort((a, b) => a.daysOfStock - b.daysOfStock)
    .slice(0, 15);

  const stale = [...rows]
    .filter((p) => p.rotationDays > 30 && p.stockQty > 1)
    .sort((a, b) => b.rotationDays - a.rotationDays)
    .slice(0, 15);

  const noMargin = [...rows]
    .filter((p) => p.salePrice > 0 && p.cmp > 0 && p.marginPct < 15 && p.avgDailySales7d > 0)
    .sort((a, b) => a.marginPct - b.marginPct)
    .slice(0, 10);

  return {
    category: rawCategory ?? "Sin categoría",
    rawCategory,
    totals: {
      productCount: rows.length,
      activeProducts,
      inventoryValue,
      retailValue,
      avgMarginPct,
      totalDailySales,
    },
    topByVelocity,
    topByValue,
    criticalStock,
    stale,
    noMargin,
  };
}
