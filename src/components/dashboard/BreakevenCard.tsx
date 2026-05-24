import { cn, formatCurrency } from "@/lib/utils";
import { Target, TrendingUp, TrendingDown } from "lucide-react";
import type { BreakevenAnalysis } from "@/lib/analytics/breakeven";

interface Props {
  data: BreakevenAnalysis;
}

export function BreakevenCard({ data }: Props) {
  const {
    fixedExpensesDaily,
    avgGrossMarginPct,
    breakevenRevenue,
    breakevenTransactions,
    todayRevenue,
    todayTransactions,
    todayProgress,
    todayDelta,
    daysAboveBreakeven30d,
    daysObserved30d,
  } = data;

  const reached = todayProgress >= 1;
  const progressClamped = Math.min(Math.max(todayProgress, 0), 1.5);
  const tone = reached ? "primary" : todayProgress >= 0.7 ? "warning" : "destructive";
  const colors = {
    primary: { bar: "bg-primary", text: "text-primary", border: "border-primary/40", bg: "bg-primary/5" },
    warning: { bar: "bg-warning", text: "text-warning", border: "border-warning/40", bg: "bg-warning/5" },
    destructive: { bar: "bg-destructive", text: "text-destructive", border: "border-destructive/40", bg: "bg-destructive/5" },
  }[tone];

  const consistencyPct = daysObserved30d > 0 ? (daysAboveBreakeven30d / daysObserved30d) * 100 : 0;

  return (
    <div className={cn("rounded-xl border p-5 space-y-4", colors.border, colors.bg)}>
      <div className="flex items-start gap-3">
        <Target className={cn("h-5 w-5 mt-0.5", colors.text)} />
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Punto de Equilibrio Diario</h3>
          <p className="text-xs text-muted-foreground">
            Necesitas vender <span className={cn("font-semibold", colors.text)}>{formatCurrency(breakevenRevenue)}</span>{" "}
            cada día para cubrir gastos fijos (~{breakevenTransactions} transacciones).
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-end justify-between text-xs">
          <div className="flex items-baseline gap-2">
            <span className={cn("text-2xl font-bold", colors.text)}>{formatCurrency(todayRevenue)}</span>
            <span className="text-muted-foreground">de {formatCurrency(breakevenRevenue)}</span>
          </div>
          <div className={cn("flex items-center gap-1 font-medium", colors.text)}>
            {reached ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {(todayProgress * 100).toFixed(0)}%
          </div>
        </div>
        <div className="relative h-3 w-full rounded-full bg-secondary/40 overflow-hidden">
          <div
            className={cn("h-full transition-all", colors.bar)}
            style={{ width: `${Math.min(progressClamped * 100, 100)}%` }}
          />
          {/* Marca del 100% */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/50" style={{ left: "100%", transform: "translateX(-50%)" }} />
        </div>
        <p className={cn("text-xs", colors.text)}>
          {reached
            ? `✓ Equilibrio cubierto. Cada peso adicional es utilidad neta. ${formatCurrency(Math.abs(todayDelta))} sobre el breakeven.`
            : `Te faltan ${formatCurrency(Math.abs(todayDelta))} para cubrir gastos fijos del día.`}
        </p>
      </div>

      {/* Stats secundarias */}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border xl:grid-cols-4">
        <Stat label="Gastos fijos/día" value={formatCurrency(fixedExpensesDaily)} />
        <Stat label="Margen bruto promedio" value={`${avgGrossMarginPct.toFixed(1)}%`} />
        <Stat label="Hoy: transacciones" value={`${todayTransactions} / ${breakevenTransactions}`} />
        <Stat
          label="Consistencia 30d"
          value={`${daysAboveBreakeven30d}/${daysObserved30d} días`}
          subtitle={`${consistencyPct.toFixed(0)}% por encima`}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
