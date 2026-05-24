export const dynamic = "force-dynamic";

import { getABCAnalysis, type ABCTier } from "@/lib/analytics/abc";
import { formatCurrency, cn } from "@/lib/utils";
import { Trophy, BarChart3, Layers } from "lucide-react";

const TIER_COLORS: Record<ABCTier, { bg: string; text: string; border: string; label: string; description: string }> = {
  A: {
    bg: "bg-primary/10",
    text: "text-primary",
    border: "border-primary/40",
    label: "Tier A — Esenciales",
    description: "El 80% de tus ingresos. Nunca pueden faltar.",
  },
  B: {
    bg: "bg-warning/10",
    text: "text-warning",
    border: "border-warning/40",
    label: "Tier B — Soporte",
    description: "El 15% siguiente. Mantén stock con holgura.",
  },
  C: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-border",
    label: "Tier C — Largo plazo",
    description: "El último 5%. Considera reducir SKUs o descontinuar.",
  },
};

export default async function ABCPage() {
  const data = await getABCAnalysis().catch(() => null);

  if (!data || data.products.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Análisis ABC</h1>
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <BarChart3 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Aún no hay productos con ventas para clasificar</p>
        </div>
      </div>
    );
  }

  const { products, tierSummary, paretoCount, paretoPct, totalMonthlyRevenue, totalMonthlyProfit } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Análisis ABC · Pareto 80/20</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Clasificación de productos por participación en revenue. Ingresos proyectados a 30 días desde velocidad observada.
        </p>
      </div>

      {/* Headline insight: Pareto */}
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-5 flex items-start gap-3">
        <Trophy className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">Tu ley de Pareto</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-primary">{paretoCount} productos</span> (
            <span className="text-foreground">{paretoPct.toFixed(1)}% del catálogo activo</span>) generan el{" "}
            <span className="font-semibold text-primary">80% de tus ingresos</span>. Estos son los que NUNCA pueden estar sin stock.
          </p>
        </div>
      </div>

      {/* Tier summary cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {(["A", "B", "C"] as const).map((tier) => {
          const t = tierSummary[tier];
          const c = TIER_COLORS[tier];
          return (
            <div key={tier} className={cn("rounded-xl border p-5 space-y-3", c.border, c.bg)}>
              <div className="flex items-center gap-2">
                <Layers className={cn("h-4 w-4", c.text)} />
                <h3 className={cn("text-sm font-semibold", c.text)}>{c.label}</h3>
              </div>
              <p className="text-xs text-muted-foreground">{c.description}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Productos</p>
                  <p className="text-lg font-bold">{t.count}</p>
                  <p className="text-muted-foreground">{t.productPct.toFixed(0)}% del catálogo</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Revenue mensual</p>
                  <p className={cn("text-lg font-bold", c.text)}>{t.revenueShare.toFixed(0)}%</p>
                  <p className="text-muted-foreground">{t.profitShare.toFixed(0)}% utilidad</p>
                </div>
              </div>
              <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                Inv. invertido: <span className="text-foreground font-medium">{formatCurrency(t.inventoryValue)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Top 30 productos */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Top 30 Productos por Revenue Proyectado</h3>
          <span className="ml-auto text-xs text-muted-foreground">
            Total mensual proyectado: {formatCurrency(totalMonthlyRevenue)} · utilidad {formatCurrency(totalMonthlyProfit)}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground bg-secondary/30">
                <th className="px-3 py-2 text-left font-medium w-10">#</th>
                <th className="px-3 py-2 text-center font-medium w-10">Tier</th>
                <th className="px-3 py-2 text-left font-medium">Producto</th>
                <th className="px-3 py-2 text-left font-medium">Categoría</th>
                <th className="px-3 py-2 text-right font-medium">Vel/día</th>
                <th className="px-3 py-2 text-right font-medium">Stock</th>
                <th className="px-3 py-2 text-right font-medium">Margen</th>
                <th className="px-3 py-2 text-right font-medium">Rev mes</th>
                <th className="px-3 py-2 text-right font-medium">Acum %</th>
              </tr>
            </thead>
            <tbody>
              {products.slice(0, 30).map((p) => {
                const c = TIER_COLORS[p.tier];
                return (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                    <td className="px-3 py-2 text-muted-foreground">{p.rank}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn("inline-flex items-center justify-center w-6 h-6 rounded-full font-bold", c.bg, c.text)}>
                        {p.tier}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium max-w-64 truncate">{p.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.category ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{p.avgDailySales7d.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Math.round(p.stockQty)}</td>
                    <td className={cn("px-3 py-2 text-right font-medium", p.marginPct < 0 ? "text-destructive" : p.marginPct < 20 ? "text-warning" : "text-foreground")}>
                      {p.marginPct.toFixed(0)}%
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(p.monthlyRevenueProxy)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{p.cumulativeRevenuePct.toFixed(1)}%</td>
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
