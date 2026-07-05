export const dynamic = "force-dynamic";

import type { ReactNode } from "react";
import { getABCAnalysis, type ABCTier } from "@/lib/analytics/abc";
import { getOpportunities, type OppProduct } from "@/lib/analytics/opportunities";
import { ABCTable } from "@/components/dashboard/ABCTable";
import { formatCurrency, cn } from "@/lib/utils";
import { Trophy, BarChart3, Layers, Lightbulb, Star, TrendingDown, Archive } from "lucide-react";

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
  const [data, opps] = await Promise.all([
    getABCAnalysis().catch(() => null),
    getOpportunities().catch(() => null),
  ]);

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

      {/* Oportunidades de acción */}
      {opps && (opps.stars.length > 0 || opps.lowMargin.length > 0 || opps.deadStock.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Oportunidades de acción</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <OppCard
              title="Impulsar — estrellas"
              subtitle={`Venden y dejan margen · ${formatCurrency(opps.starsRevenue)}/mes`}
              tone="primary"
              icon={<Star className="h-4 w-4" />}
              items={opps.stars}
              metric="star"
            />
            <OppCard
              title="Subir precio — margen bajo"
              subtitle="Venden pero dejan muy poco"
              tone="warning"
              icon={<TrendingDown className="h-4 w-4" />}
              items={opps.lowMargin}
              metric="margin"
            />
            <OppCard
              title="Liquidar — capital muerto"
              subtitle={`${formatCurrency(opps.deadStockTotal)} sin rotar`}
              tone="destructive"
              icon={<Archive className="h-4 w-4" />}
              items={opps.deadStock}
              metric="dead"
            />
          </div>
        </div>
      )}

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

      <ABCTable products={products} totalMonthlyRevenue={totalMonthlyRevenue} totalMonthlyProfit={totalMonthlyProfit} />
    </div>
  );
}

function OppCard({
  title,
  subtitle,
  tone,
  icon,
  items,
  metric,
}: {
  title: string;
  subtitle: string;
  tone: "primary" | "warning" | "destructive";
  icon: ReactNode;
  items: OppProduct[];
  metric: "star" | "margin" | "dead";
}) {
  const c =
    tone === "primary"
      ? { text: "text-primary", bg: "bg-primary/5", border: "border-primary/40" }
      : tone === "warning"
        ? { text: "text-warning", bg: "bg-warning/5", border: "border-warning/40" }
        : { text: "text-destructive", bg: "bg-destructive/5", border: "border-destructive/40" };
  return (
    <div className={cn("rounded-xl border p-4 space-y-3", c.border, c.bg)}>
      <div className="flex items-start gap-2">
        <span className={cn("mt-0.5", c.text)}>{icon}</span>
        <div>
          <p className={cn("text-sm font-semibold", c.text)}>{title}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Nada por aquí 👍</p>
        ) : (
          items.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-2 text-xs border-b border-border/50 last:border-0 pb-1.5 last:pb-0">
              <span className="truncate flex-1" title={p.name}>{p.name}</span>
              <span className={cn("shrink-0 font-medium tabular-nums", c.text)}>
                {metric === "star"
                  ? `${p.velocity.toFixed(1)}/d · ${p.marginPct.toFixed(0)}%`
                  : metric === "margin"
                    ? `${p.marginPct.toFixed(0)}%`
                    : formatCurrency(p.inventoryValue)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
