export const dynamic = "force-dynamic";

import { getDeadStockAnalysis, getLiquidationGoal } from "@/lib/analytics/dead-stock";
import { LiquidationGoalEditor } from "@/components/dashboard/LiquidationGoalEditor";
import { LiquidationWorkspace } from "@/components/dashboard/LiquidationWorkspace";
import { formatCurrency, cn } from "@/lib/utils";
import { PackageX, AlertTriangle } from "lucide-react";

export default async function LiquidacionPage() {
  const analysis = await getDeadStockAnalysis().catch(() => null);

  if (!analysis) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Plan de Liquidación</h1>
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <PackageX className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Sin capital muerto detectado — todo tu inventario rota bien 👍</p>
        </div>
      </div>
    );
  }

  // Se fija ANTES del chequeo de "sin capital muerto": si hay una meta
  // fijada, llegar a $0 de capital muerto es justo el momento en que se
  // cumplió — hay que mostrarlo, no ocultar la meta detrás del empty state.
  const goal = await getLiquidationGoal(analysis.totalInvestedCapital).catch(() => ({
    goalAmount: 0,
    baseline: 0,
    updatedAt: null,
    currentDeadStock: analysis.totalInvestedCapital,
  }));

  if (analysis.products.length === 0) {
    if (goal.goalAmount > 0) {
      return (
        <div className="space-y-6">
          <h1 className="text-xl font-bold">Plan de Liquidación de Capital Muerto</h1>
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-8 text-center space-y-2">
            <PackageX className="h-8 w-8 text-primary mx-auto" />
            <p className="text-sm font-semibold text-primary">¡Meta cumplida! Ya no tienes capital muerto.</p>
          </div>
          <LiquidationGoalEditor
            goalAmount={goal.goalAmount}
            baseline={goal.baseline}
            currentDeadStock={goal.currentDeadStock}
            updatedAt={goal.updatedAt}
          />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Plan de Liquidación</h1>
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <PackageX className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Sin capital muerto detectado — todo tu inventario rota bien 👍</p>
        </div>
      </div>
    );
  }

  const severity = analysis.deadStockPctOfInventory > 50 ? "destructive" : analysis.deadStockPctOfInventory > 25 ? "warning" : "primary";
  const tone = {
    destructive: { text: "text-destructive", bg: "bg-destructive/5", border: "border-destructive/40" },
    warning: { text: "text-warning", bg: "bg-warning/5", border: "border-warning/40" },
    primary: { text: "text-primary", bg: "bg-primary/5", border: "border-primary/40" },
  }[severity];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Plan de Liquidación de Capital Muerto</h1>

      <div className={cn("rounded-xl border p-5", tone.border, tone.bg)}>
        <div className="flex items-start gap-3">
          <AlertTriangle className={cn("h-6 w-6 mt-0.5 shrink-0", tone.text)} />
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Capital inmovilizado</p>
            <p className={cn("text-3xl font-bold", tone.text)}>{formatCurrency(analysis.totalInvestedCapital)}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              El <span className={cn("font-semibold", tone.text)}>{analysis.deadStockPctOfInventory.toFixed(0)}%</span> de tu inventario total
              ({formatCurrency(analysis.totalInventoryValue)}) no se ha vendido en más de 30 días.
              Valor retail si se vendiera a precio normal: {formatCurrency(analysis.totalRetailValue)}.
            </p>
          </div>
        </div>
      </div>

      <LiquidationGoalEditor
        goalAmount={goal.goalAmount}
        baseline={goal.baseline}
        currentDeadStock={goal.currentDeadStock}
        updatedAt={goal.updatedAt}
      />

      <LiquidationWorkspace products={analysis.products} />

      {analysis.byCategory.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
          <h3 className="text-sm font-semibold">Capital muerto por categoría</h3>
          <div className="space-y-2">
            {analysis.byCategory.map((c) => {
              const maxVal = analysis.byCategory[0].investedCapital;
              const widthPct = maxVal > 0 ? (c.investedCapital / maxVal) * 100 : 0;
              return (
                <div key={c.category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{c.category} <span className="text-muted-foreground">({c.productCount})</span></span>
                    <span className="font-semibold">{formatCurrency(c.investedCapital)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary/40 overflow-hidden">
                    <div className="h-full bg-destructive/50 rounded-full" style={{ width: `${widthPct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
