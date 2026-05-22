import { prisma } from "@/lib/prisma";
import { formatCurrency, stockStatus } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Package, AlertTriangle, XCircle, CheckCircle } from "lucide-react";

async function getInventoryData() {
  const [critical, warning, healthy, stale] = await Promise.all([
    prisma.productInsight.findMany({ where: { daysOfStock: { lt: 5 } }, orderBy: { daysOfStock: "asc" } }),
    prisma.productInsight.findMany({ where: { daysOfStock: { gte: 5, lt: 14 } }, orderBy: { daysOfStock: "asc" } }),
    prisma.productInsight.findMany({ where: { daysOfStock: { gte: 14 } }, orderBy: { daysOfStock: "desc" }, take: 20 }),
    prisma.productInsight.findMany({ where: { rotationDays: { gt: 30 } }, orderBy: { rotationDays: "desc" }, take: 10 }),
  ]);

  return { critical, warning, healthy, stale };
}

export default async function InventarioPage() {
  const { critical, warning, healthy, stale } = await getInventoryData();
  const all = [...critical, ...warning, ...healthy];

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
          <h3 className="text-sm font-semibold">Todos los Productos</h3>
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
                const status = stockStatus(p.stockQty, p.minStock);
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
