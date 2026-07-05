import { prisma } from "@/lib/prisma";

export interface DeadStockProduct {
  id: string;
  name: string;
  category: string | null;
  stockQty: number;
  cmp: number;
  salePrice: number;
  rotationDays: number;
  lastSoldAt: Date | null;
  investedCapital: number; // stockQty * cmp
  retailValue: number;     // stockQty * salePrice
}

export interface DeadStockByCategory {
  category: string;
  investedCapital: number;
  retailValue: number;
  productCount: number;
}

export interface DeadStockAnalysis {
  products: DeadStockProduct[];      // todos, sin cap — la tabla filtra/pagina en cliente
  totalInvestedCapital: number;
  totalRetailValue: number;
  totalInventoryValue: number;       // valor de TODO el inventario con stock > 0
  deadStockPctOfInventory: number;   // totalInvestedCapital / totalInventoryValue * 100
  byCategory: DeadStockByCategory[]; // ordenado por investedCapital desc
}

export async function getDeadStockAnalysis(): Promise<DeadStockAnalysis> {
  const [deadRows, allRows] = await Promise.all([
    prisma.productInsight.findMany({
      where: { rotationDays: { gt: 30 }, stockQty: { gt: 0 } },
      orderBy: { rotationDays: "desc" },
    }),
    prisma.productInsight.findMany({
      where: { stockQty: { gt: 0 } },
      select: { stockQty: true, cmp: true },
    }),
  ]);

  const products: DeadStockProduct[] = deadRows.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    stockQty: p.stockQty,
    cmp: p.cmp,
    salePrice: p.salePrice,
    rotationDays: p.rotationDays,
    lastSoldAt: p.lastSoldAt,
    investedCapital: p.stockQty * p.cmp,
    retailValue: p.stockQty * p.salePrice,
  }));

  const totalInvestedCapital = products.reduce((s, p) => s + p.investedCapital, 0);
  const totalRetailValue = products.reduce((s, p) => s + p.retailValue, 0);
  const totalInventoryValue = allRows.reduce((s, r) => s + r.stockQty * r.cmp, 0);
  const deadStockPctOfInventory = totalInventoryValue > 0 ? (totalInvestedCapital / totalInventoryValue) * 100 : 0;

  const catMap = new Map<string, { investedCapital: number; retailValue: number; productCount: number }>();
  for (const p of products) {
    const key = p.category ?? "Sin categoría";
    const cur = catMap.get(key) ?? { investedCapital: 0, retailValue: 0, productCount: 0 };
    cur.investedCapital += p.investedCapital;
    cur.retailValue += p.retailValue;
    cur.productCount += 1;
    catMap.set(key, cur);
  }
  const byCategory: DeadStockByCategory[] = Array.from(catMap.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.investedCapital - a.investedCapital);

  return {
    products,
    totalInvestedCapital,
    totalRetailValue,
    totalInventoryValue,
    deadStockPctOfInventory,
    byCategory,
  };
}
