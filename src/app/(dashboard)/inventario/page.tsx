export const dynamic = 'force-dynamic';

import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Package, AlertTriangle, XCircle, CheckCircle } from "lucide-react";

// Clasifica por días de stock — coherente con las tarjetas KPI de arriba.
function stockHealth(daysOfStock: number): "critical" | "warning" | "ok" {
  if (daysOfStock < 5) return "critical";
  if (daysOfStock < 14) return "warning";
  return "ok";
}

async function getInventoryData() {
  // `daysOfStock` solo tiene sentido para productos que venden. Para los que no
  // venden, el sync deja daysOfStock=0 (sentinel). Por eso filtramos por
  // avgDailySales7d>0 ANTES de clasificar: de lo contrario, todo el catálogo sin
  // ventas (la mayoría de SKUs) caería en "<5 días" e inflaría el conteo crítico.
  const withSales = await prisma.productInsight.findMany({
    where: { avgDailySales7d: { gt: 0 } },
    orderBy: { daysOfStock: "asc" },
  });
  // daysOfStock<5 incluye 0 = vende pero sin stock (lo más urgente de todo).
  const critical = withSales.filter((p) => p.daysOfStock < 5);
  const warning = withSales.filter((p) => p.daysOfStock >= 5 && p.daysOfStock < 14);
  const healthy = withSales.filter((p) => p.daysOfStock >= 14);

  // Stock muerto: con existencias pero sin rotación hace +30 días.
  const stale = await prisma.productInsight.findMany({
    where: { rotationDays: { gt: 30 }, stockQty: { gt: 0 } },
    orderBy: { rotationDays: "desc" },
    take: 15,
  });

  return { all: withSales, critical, warning, healthy, stale };
}

export default async function InventarioPage() {
  const { all, critical, warning, healthy, stale } = await getInventoryData().catch(() => ({ all: [] as Awaited<ReturnType<typeof getInventoryData>>["all"], critical: [] as Awaited<ReturnType<typeof getInventoryData>>["critical"], warning: [] as Awaited<ReturnType<typeof getInventoryData>>["warning"], healthy: [] as Awaited<ReturnType<typeof getInventoryData>>["healthy"], stale: [] as Awaited<ReturnType<typeof getInventoryData>>["stale"] }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Inteligencia de Inventario</h1>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-center">
          <XCircle className="h-5 w-5 text-destructive mx-auto mb-1" />
          <p className="text-2xl font-bold text-destructive">{critical.length}</p>
          <p className="text-xs text-muted-foreground">Críticos (&lt;5 días)</p>
        </div>
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-center">
          <AlertTriangle className="h-5 w-5 text-warning mx-auto mb-1" />
          <p className="text-2xl font-bold text-warning">{warning.length}</p>
          <p className="text-xs text-muted-foreground">Advertencia (5-14 días)</p>
        </div>
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 text-center">
          <CheckCircle className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-2xl font-bold text-primary">{healthy.length}</p>
          <p className="text-xs text-muted-foreground">OK (&gt;14 días)</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Productos con Rotación ({all.length})</h3>
          <span className="ml-auto text-xs text-muted-foreground">ordenado por urgencia de reposición</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 text-left font-medium">Producto</th>
                <th className="py-2 text-right font-medium">Stock</th>
                <th className="py-2 text-right font-medium">Días Stock</th>
                <th className="py-2 text-right font-medium">Precio</th>
                <th className="py-2 text-right font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {all.map((p) => {
                const status = stockHealth(p.daysOfStock);
                return (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="py-2 font-medium max-w-48 truncate">{p.name}</td>
                    <td className="py-2 text-right">{p.stockQty.toFixed(0)}</td>
                    <td className={cn("py-2 text-right font-medium",
                      status === "critical" ? "text-destructive" : status === "warning" ? "text-warning" : "text-primary"
                    )}>
                      {p.daysOfStock.toFixed(0)}d
                    </td>
                    <td className="py-2 text-right text-muted-foreground">{formatCurrency(p.salePrice)}</td>
                    <td className="py-2 text-right">
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium",
                        status === "critical" ? "bg-destructive/10 text-destructive"
                        : status === "warning" ? "bg-warning/10 text-warning"
                        : "bg-primary/10 text-primary"
                      )}>
                        {status === "critical" ? "Crítico" : status === "warning" ? "Bajo" : "OK"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {stale.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Sin Rotación (&gt;30 días)</h3>
          <div className="space-y-2">
            {stale.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <p className="text-xs font-medium">{p.name}</p>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{p.rotationDays} días sin venta</p>
                  <p className="text-xs font-medium">{p.stockQty.toFixed(0)} en stock</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
