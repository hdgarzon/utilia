export const dynamic = "force-dynamic";

import Link from "next/link";
import { getOpenToBuyPlan } from "@/lib/analytics/open-to-buy";
import { formatCurrency, cn } from "@/lib/utils";
import { ShoppingBag, TrendingUp, AlertCircle, Wallet, ChevronRight } from "lucide-react";

const SENTINEL_NULL = "_sin_categoria";

function categoryHref(rawCategory: string | null): string {
  const slug = rawCategory === null ? SENTINEL_NULL : encodeURIComponent(rawCategory);
  return `/categorias/${slug}`;
}

interface PageProps {
  searchParams: Promise<{ coverage?: string }>;
}

export default async function ComprasPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const coverage = Math.max(7, Math.min(90, Number(params.coverage) || 21));

  const plan = await getOpenToBuyPlan(coverage).catch(() => null);

  if (!plan || plan.categories.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Plan de Compras</h1>
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <ShoppingBag className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Aún no hay datos de velocidad para proyectar compras</p>
        </div>
      </div>
    );
  }

  const { categories, totals, coverageDaysTarget } = plan;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Plan de Compras (Open-to-Buy)</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cuánto comprar en cada categoría para los próximos 30 días + {coverageDaysTarget} días de cobertura objetivo
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Cobertura objetivo:</span>
          {[14, 21, 30, 45].map((d) => (
            <Link
              key={d}
              href={`/compras?coverage=${d}`}
              className={cn(
                "rounded-lg border px-3 py-1.5 font-medium transition-colors",
                d === coverageDaysTarget
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card hover:bg-secondary"
              )}
            >
              {d}d
            </Link>
          ))}
        </div>
      </div>

      {/* KPIs totales */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Wallet className="h-3 w-3" />
            Inversión sugerida
          </p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(totals.totalInvestment)}</p>
          <p className="text-xs text-muted-foreground">{Math.round(totals.totalUnits).toLocaleString("es-CO")} unidades total</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Revenue proyectado</p>
          <p className="text-2xl font-bold">{formatCurrency(totals.totalProjectedRevenue)}</p>
          <p className="text-xs text-muted-foreground">próximos 30 días</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Utilidad proyectada</p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(totals.totalProjectedProfit)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" />
            ROI promedio
          </p>
          <p className={cn("text-2xl font-bold", totals.avgROI >= 30 ? "text-primary" : totals.avgROI >= 15 ? "text-foreground" : "text-warning")}>
            {totals.avgROI.toFixed(0)}%
          </p>
          <p className="text-xs text-muted-foreground">utilidad / inversión</p>
        </div>
      </div>

      {/* Tabla por categoría */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Detalle por Categoría</h3>
          <span className="ml-auto text-xs text-muted-foreground">ordenado por revenue proyectado</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground bg-secondary/30">
                <th className="px-4 py-2.5 text-left font-medium">Categoría</th>
                <th className="px-4 py-2.5 text-right font-medium">Vel/día</th>
                <th className="px-4 py-2.5 text-right font-medium">Stock actual</th>
                <th className="px-4 py-2.5 text-right font-medium">Cobertura</th>
                <th className="px-4 py-2.5 text-right font-medium">Unidades a comprar</th>
                <th className="px-4 py-2.5 text-right font-medium">CMP prom</th>
                <th className="px-4 py-2.5 text-right font-medium">Inversión</th>
                <th className="px-4 py-2.5 text-right font-medium">ROI</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => {
                const coverageStatus =
                  c.currentCoverageDays < 7 ? "destructive" : c.currentCoverageDays < 14 ? "warning" : c.currentCoverageDays > 60 ? "warning" : "ok";
                const coverageColor =
                  coverageStatus === "destructive" ? "text-destructive" : coverageStatus === "warning" ? "text-warning" : "text-foreground";
                const roiColor = c.estimatedROI >= 30 ? "text-primary" : c.estimatedROI >= 15 ? "text-foreground" : "text-warning";

                return (
                  <tr key={c.category} className="border-b border-border last:border-0 hover:bg-secondary/20 group">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={categoryHref(c.rawCategory)}
                        className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        {c.category}
                        <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right">{c.totalDailySales.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right">{Math.round(c.currentStockUnits).toLocaleString("es-CO")}</td>
                    <td className={cn("px-4 py-3 text-right font-medium", coverageColor)}>
                      {c.currentCoverageDays.toFixed(0)}d
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-primary">
                      {Math.round(c.unitsToBuy).toLocaleString("es-CO")}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{formatCurrency(c.avgCMP)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(c.estimatedInvestment)}</td>
                    <td className={cn("px-4 py-3 text-right font-semibold", roiColor)}>
                      {c.estimatedROI.toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nota metodológica */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
          <p>
            <strong className="text-foreground">Fórmula:</strong>{" "}
            <code className="rounded bg-secondary px-1 py-0.5 text-foreground">
              OTB = (velocidad/día × 30) + (velocidad/día × {coverageDaysTarget}) − stock_actual
            </code>
          </p>
          <p>
            La <strong className="text-foreground">cobertura objetivo</strong> es el colchón de stock que querés tener al cierre del mes
            (default 21 días). Subila si tu proveedor tarda, bajala si tu capital de trabajo está apretado.
          </p>
          <p>
            <strong className="text-foreground">ROI</strong> compara la utilidad proyectada mensual contra la inversión sugerida. ROI &gt;30% mensual indica una categoría muy rentable.
          </p>
        </div>
      </div>
    </div>
  );
}
