export const dynamic = "force-dynamic";

import Link from "next/link";
import { getCategoryStats } from "@/lib/analytics/categories";
import { formatCurrency, cn } from "@/lib/utils";
import { Tags, AlertTriangle, Package, TrendingUp, ChevronRight } from "lucide-react";

const SENTINEL_NULL = "_sin_categoria";

function categoryHref(rawCategory: string | null): string {
  const slug = rawCategory === null ? SENTINEL_NULL : encodeURIComponent(rawCategory);
  return `/categorias/${slug}`;
}

export default async function CategoriasPage() {
  const stats = await getCategoryStats().catch(() => []);

  if (stats.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Categorías</h1>
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Tags className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Aún no hay datos de categorías</p>
        </div>
      </div>
    );
  }

  const totalProducts = stats.reduce((s, c) => s + c.productCount, 0);
  const totalInventoryValue = stats.reduce((s, c) => s + c.inventoryValue, 0);
  const totalRetailValue = stats.reduce((s, c) => s + c.retailValue, 0);
  const totalCritical = stats.reduce((s, c) => s + c.criticalStockCount, 0);
  const maxValue = Math.max(...stats.map((c) => c.inventoryValue));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Análisis por Categoría</h1>

      {/* KPIs globales */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Categorías activas</p>
          <p className="text-2xl font-bold">{stats.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Productos totales</p>
          <p className="text-2xl font-bold">{totalProducts.toLocaleString("es-CO")}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor inventario (CMP)</p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(totalInventoryValue)}</p>
          <p className="text-xs text-muted-foreground">Retail: {formatCurrency(totalRetailValue)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Stock crítico</p>
          <p className={cn("text-2xl font-bold", totalCritical > 0 ? "text-destructive" : "text-foreground")}>
            {totalCritical}
          </p>
          <p className="text-xs text-muted-foreground">productos en {stats.filter((c) => c.criticalStockCount > 0).length} categorías</p>
        </div>
      </div>

      {/* Tabla detallada */}
      <div className="rounded-xl border border-border bg-card">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Detalle por Categoría</h3>
          <span className="ml-auto text-xs text-muted-foreground">ordenado por valor de inventario</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground bg-secondary/30">
                <th className="px-4 py-2.5 text-left font-medium">Categoría</th>
                <th className="px-4 py-2.5 text-right font-medium">Productos</th>
                <th className="px-4 py-2.5 text-right font-medium">Stock</th>
                <th className="px-4 py-2.5 text-right font-medium">Valor (CMP)</th>
                <th className="px-4 py-2.5 text-right font-medium">Margen</th>
                <th className="px-4 py-2.5 text-right font-medium">ROI mes</th>
                <th className="px-4 py-2.5 text-right font-medium">Vel. venta</th>
                <th className="px-4 py-2.5 text-center font-medium">Alertas</th>
                <th className="px-4 py-2.5 text-left font-medium w-32">Peso relativo</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((c) => {
                const widthPct = maxValue > 0 ? (c.inventoryValue / maxValue) * 100 : 0;
                const marginTone =
                  c.avgMarginPct >= 30 ? "text-primary" : c.avgMarginPct >= 15 ? "text-foreground" : "text-warning";
                return (
                  <tr key={c.category} className="border-b border-border last:border-0 hover:bg-secondary/20 group">
                    <td className="px-4 py-3 font-medium max-w-48 truncate">
                      <Link
                        href={categoryHref(c.rawCategory)}
                        className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        {c.category}
                        <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.productCount}
                      <span className="text-muted-foreground ml-1">({c.productsWithSales} act.)</span>
                    </td>
                    <td className="px-4 py-3 text-right">{Math.round(c.totalStock).toLocaleString("es-CO")}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(c.inventoryValue)}</td>
                    <td className={cn("px-4 py-3 text-right font-medium", marginTone)}>
                      {c.avgMarginPct.toFixed(1)}%
                    </td>
                    <td className={cn(
                      "px-4 py-3 text-right font-medium",
                      c.inventoryROI >= 30 ? "text-primary" : c.inventoryROI >= 15 ? "text-foreground" : "text-warning"
                    )}>
                      {c.inventoryROI > 0 ? `${c.inventoryROI.toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.totalDailySales > 0 ? (
                        <span className="flex items-center justify-end gap-1 text-primary">
                          <TrendingUp className="h-3 w-3" />
                          {c.totalDailySales.toFixed(1)}/día
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {c.criticalStockCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive font-medium">
                            <AlertTriangle className="h-3 w-3" />
                            {c.criticalStockCount}
                          </span>
                        )}
                        {c.staleCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-warning font-medium">
                            {c.staleCount} sin rot.
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-2 w-full rounded-full bg-secondary/40 overflow-hidden">
                        <div
                          className="h-full bg-primary/50 rounded-full transition-all"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
