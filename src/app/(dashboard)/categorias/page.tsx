export const dynamic = "force-dynamic";

import { getCategoryStats } from "@/lib/analytics/categories";
import { CategoriasTable } from "@/components/dashboard/CategoriasTable";
import { formatCurrency, cn } from "@/lib/utils";
import { Tags } from "lucide-react";

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

      <CategoriasTable stats={stats} />
    </div>
  );
}
