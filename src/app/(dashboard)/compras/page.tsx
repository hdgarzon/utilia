export const dynamic = "force-dynamic";

import Link from "next/link";
import { getOpenToBuyPlan, type CoverageBrake } from "@/lib/analytics/open-to-buy";
import { formatCurrency, cn } from "@/lib/utils";
import { ShoppingBag, TrendingUp, AlertCircle, Wallet, ChevronRight, AlertTriangle, Zap, Minus } from "lucide-react";

const SENTINEL_NULL = "_sin_categoria";

function categoryHref(rawCategory: string | null): string {
  const slug = rawCategory === null ? SENTINEL_NULL : encodeURIComponent(rawCategory);
  return `/categorias/${slug}`;
}

function BrakeBadge({ brake }: { brake: CoverageBrake }) {
  if (brake === "urgente") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive font-semibold text-xs">
      <Zap className="h-2.5 w-2.5" /> Urgente
    </span>
  );
  if (brake === "freno") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-warning font-semibold text-xs">
      <AlertTriangle className="h-2.5 w-2.5" /> Freno
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-muted-foreground text-xs">
      <Minus className="h-2.5 w-2.5" /> Normal
    </span>
  );
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

  const { categories, totals, coverageDaysTarget, reinvestmentFund, reinvestmentFundDays } = plan;
  const capitalGap = totals.totalAdjustedInvestment - reinvestmentFund;

  // Síntesis para el titular "¿en qué gastar?"
  const urgentNames = categories
    .filter((c) => c.coverageBrake === "urgente" && c.unitsToBuy > 0)
    .sort((a, b) => b.adjustedInvestment - a.adjustedInvestment)
    .slice(0, 3)
    .map((c) => c.category);
  const frenoNames = categories
    .filter((c) => c.coverageBrake === "freno")
    .sort((a, b) => b.currentCoverageDays - a.currentCoverageDays)
    .slice(0, 3)
    .map((c) => c.category);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Plan de Compras (Open-to-Buy)</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            El dinero sigue la venta y la rotación — categorías más activas reciben más capital
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

      {/* Titular: ¿en qué gastar este mes? */}
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-5">
        <div className="flex items-start gap-3">
          <ShoppingBag className="h-6 w-6 mt-0.5 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">¿En qué gastar este mes?</p>
            <p className="text-lg font-bold text-primary">
              {urgentNames.length > 0
                ? `Prioriza: ${urgentNames.join(" · ")}`
                : "Sin compras urgentes — vas bien de stock"}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Inversión sugerida <span className="font-semibold text-foreground">{formatCurrency(totals.totalAdjustedInvestment)}</span>
              {capitalGap <= 0
                ? <> · <span className="text-primary font-medium">tu fondo de reposición la cubre</span></>
                : <> · <span className="text-destructive font-medium">faltan {formatCurrency(capitalGap)}</span> — empieza por las urgentes</>}
              {frenoNames.length > 0 && (
                <> · <span className="text-warning font-medium">frena (sobre-stock):</span> {frenoNames.join(", ")}</>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Fondo de Reposición — la pieza central */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Wallet className="h-3 w-3 text-primary" />
              Fondo de Reposición disponible
            </p>
            <p className="text-3xl font-bold text-primary mt-1">{formatCurrency(reinvestmentFund)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              COGS real de los últimos {reinvestmentFundDays} días — este dinero <strong className="text-foreground">ya le pertenece al inventario</strong>, no es utilidad
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Inversión sugerida (con frenos)</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(totals.totalAdjustedInvestment)}</p>
            <p className={cn("text-xs font-medium mt-0.5", capitalGap > 0 ? "text-destructive" : "text-primary")}>
              {capitalGap > 0
                ? `⚠ Faltan ${formatCurrency(capitalGap)} — considera priorizar categorías urgentes`
                : `✓ El fondo cubre la inversión con ${formatCurrency(-capitalGap)} de margen`}
            </p>
          </div>
        </div>
      </div>

      {/* KPIs totales */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Inversión OTB total</p>
          <p className="text-2xl font-bold">{formatCurrency(totals.totalInvestment)}</p>
          <p className="text-xs text-muted-foreground">sin aplicar frenos</p>
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
            <TrendingUp className="h-3 w-3" /> ROI promedio
          </p>
          <p className={cn("text-2xl font-bold", totals.avgROI >= 30 ? "text-primary" : totals.avgROI >= 15 ? "text-foreground" : "text-warning")}>
            {totals.avgROI.toFixed(0)}%
          </p>
          <p className="text-xs text-muted-foreground">utilidad / inversión</p>
        </div>
      </div>

      {/* Tabla de distribución */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Distribución del Capital por Categoría</h3>
          <span className="ml-auto text-xs text-muted-foreground">ordenado por participación en ventas</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground bg-secondary/30">
                <th className="px-4 py-2.5 text-left font-medium">Categoría</th>
                <th className="px-4 py-2.5 text-right font-medium">% Ventas</th>
                <th className="px-4 py-2.5 text-right font-medium">Fondo asignado</th>
                <th className="px-4 py-2.5 text-right font-medium">Cobertura actual</th>
                <th className="px-4 py-2.5 text-center font-medium">Señal</th>
                <th className="px-4 py-2.5 text-right font-medium">Unidades a comprar</th>
                <th className="px-4 py-2.5 text-right font-medium">Inversión OTB</th>
                <th className="px-4 py-2.5 text-right font-medium">Ajustada</th>
                <th className="px-4 py-2.5 text-right font-medium">ROI</th>
              </tr>
            </thead>
            <tbody>
              {[...categories].sort((a, b) => b.salesParticipationPct - a.salesParticipationPct).map((c) => {
                const coverageColor =
                  c.coverageBrake === "urgente" ? "text-destructive font-semibold"
                  : c.coverageBrake === "freno" ? "text-warning"
                  : "text-foreground";
                const roiColor = c.estimatedROI >= 30 ? "text-primary" : c.estimatedROI >= 15 ? "text-foreground" : "text-warning";
                const barWidth = Math.min(c.salesParticipationPct, 100);

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
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full bg-primary/60 rounded-full" style={{ width: `${barWidth}%` }} />
                        </div>
                        <span className="font-medium w-10 text-right">{c.salesParticipationPct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-primary">
                      {formatCurrency(c.reinvestmentShare)}
                    </td>
                    <td className={cn("px-4 py-3 text-right", coverageColor)}>
                      {c.currentCoverageDays.toFixed(0)}d
                    </td>
                    <td className="px-4 py-3 text-center">
                      <BrakeBadge brake={c.coverageBrake} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {Math.round(c.unitsToBuy).toLocaleString("es-CO")}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {formatCurrency(c.estimatedInvestment)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {c.coverageBrake === "freno"
                        ? <span className="text-warning">{formatCurrency(c.adjustedInvestment)} <span className="text-xs opacity-70">(−50%)</span></span>
                        : formatCurrency(c.adjustedInvestment)}
                    </td>
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
        <div className="text-xs text-muted-foreground leading-relaxed space-y-1.5">
          <p>
            <strong className="text-foreground">Fondo de Reposición:</strong> El COGS de los últimos 30 días no es utilidad — es el dinero que debe volver al inventario. El error común es usarlo para pagar gastos fijos y luego no tener capital para recomprar.
          </p>
          <p>
            <strong className="text-foreground">Freno de mano:</strong> Cobertura {">"}60 días → inversión reducida al 50% (ya tenés demasiado stock). Cobertura {"<"}30 días → urgente, invertir el 100% de inmediato.
          </p>
          <p>
            <strong className="text-foreground">Fórmula OTB:</strong>{" "}
            <code className="rounded bg-secondary px-1 py-0.5 text-foreground">
              (vel/día × 30) + (vel/día × {coverageDaysTarget}d objetivo) − stock_actual
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}

