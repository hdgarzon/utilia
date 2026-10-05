import { cn, formatCurrency } from "@/lib/utils";
import { Target, TrendingUp, TrendingDown } from "lucide-react";
import type { BreakevenAnalysis } from "@/lib/analytics/breakeven";

interface Props {
  data: BreakevenAnalysis;
}

export function BreakevenCard({ data }: Props) {
  const {
    computable,
    fixedExpensesDaily,
    grossMarginPct,
    sellingDaysPct,
    breakevenRevenue,
    breakevenTransactions,
    todayRevenue,
    todayTransactions,
    isLiveToday,
    todayProgress,
    todayDelta,
    daysAboveBreakeven,
    daysWithSales,
    windowDays,
  } = data;

  if (!computable) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 space-y-1">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Punto de equilibrio de hoy</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {fixedExpensesDaily <= 0
            ? "Falta el presupuesto de gastos fijos para calcularlo."
            : "No hay ventas en los últimos 30 días para estimar el margen."}
        </p>
      </div>
    );
  }

  const reached = todayProgress >= 1;
  const tone = reached ? "primary" : todayProgress >= 0.7 ? "warning" : "destructive";
  const colors = {
    primary: { bar: "bg-primary", text: "text-primary", border: "border-primary/40", bg: "bg-primary/5" },
    warning: { bar: "bg-warning", text: "text-warning", border: "border-warning/40", bg: "bg-warning/5" },
    destructive: { bar: "bg-destructive", text: "text-destructive", border: "border-destructive/40", bg: "bg-destructive/5" },
  }[tone];
  const consistencyPct = daysWithSales > 0 ? (daysAboveBreakeven / daysWithSales) * 100 : 0;

  return (
    <div className={cn("rounded-xl border p-5 space-y-4", colors.border, colors.bg)}>
      <div className="flex items-start gap-3">
        <Target className={cn("h-5 w-5 mt-0.5", colors.text)} />
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Punto de equilibrio de hoy</h3>
          <p className="text-xs text-muted-foreground">
            Necesitas vender <span className={cn("font-semibold", colors.text)}>{formatCurrency(breakevenRevenue)}</span>{" "}
            cada día que abres para cubrir los gastos fijos (~{breakevenTransactions} ventas).
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-end justify-between text-xs">
          <div className="flex items-baseline gap-2">
            <span className={cn("text-2xl font-bold tabular-nums", colors.text)}>{formatCurrency(todayRevenue)}</span>
            <span className="text-muted-foreground">de {formatCurrency(breakevenRevenue)}</span>
          </div>
          <div className={cn("flex items-center gap-1 font-medium", colors.text)}>
            {reached ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {(todayProgress * 100).toFixed(0)}%
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {isLiveToday ? "En vivo desde Odoo · aún puede subir" : "Sin ventas en vivo hoy todavía"}
        </p>
        <div className="h-3 w-full rounded-full bg-secondary/40 overflow-hidden">
          <div className={cn("h-full transition-all", colors.bar)} style={{ width: `${Math.min(todayProgress, 1) * 100}%` }} />
        </div>
        <p className={cn("text-xs", colors.text)}>
          {reached
            ? `✓ Equilibrio cubierto, ${formatCurrency(Math.abs(todayDelta))} por encima. Desde aquí, de cada venta te queda ~${grossMarginPct.toFixed(0)}% como utilidad.`
            : `Te faltan ${formatCurrency(Math.abs(todayDelta))} para cubrir los gastos fijos de hoy.`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border xl:grid-cols-4">
        <Stat label="Gasto fijo por día" value={formatCurrency(fixedExpensesDaily)} subtitle={`abres el ${sellingDaysPct.toFixed(0)}% de los días`} />
        <Stat label="Margen bruto" value={`${grossMarginPct.toFixed(1)}%`} subtitle={`últimos ${windowDays} días`} />
        <Stat label="Ventas hoy" value={`${todayTransactions} / ${breakevenTransactions}`} subtitle="transacciones" />
        <Stat
          label="Días sobre el equilibrio"
          value={`${daysAboveBreakeven} de ${daysWithSales}`}
          subtitle={`${consistencyPct.toFixed(0)}% de los días abiertos (${windowDays} días)`}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
