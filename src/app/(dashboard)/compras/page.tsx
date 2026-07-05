export const dynamic = "force-dynamic";

import Link from "next/link";
import { getOpenToBuyPlan } from "@/lib/analytics/open-to-buy";
import { ComprasTable } from "@/components/dashboard/ComprasTable";
import { formatCurrency, cn } from "@/lib/utils";
import { ShoppingBag, TrendingUp, AlertCircle, Wallet } from "lucide-react";

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

      <ComprasTable categories={categories} />

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

