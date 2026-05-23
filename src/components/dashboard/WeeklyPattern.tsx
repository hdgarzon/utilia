import { cn, formatCurrency } from "@/lib/utils";
import { CalendarDays, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { WeeklyDayStat } from "@/lib/analytics/weekly-pattern";

interface Props {
  data: WeeklyDayStat[];
  title?: string;
  windowDays?: number;
  compact?: boolean;
}

export function WeeklyPattern({ data, title = "Patrón Semanal", windowDays = 60, compact = false }: Props) {
  const observed = data.filter((d) => d.daysObserved > 0);
  if (observed.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <p className="text-xs text-muted-foreground">Sin datos suficientes todavía</p>
      </div>
    );
  }

  const maxRevenue = Math.max(...observed.map((d) => d.avgRevenue));
  const best = observed[0]
    ? observed.reduce((a, b) => (a.avgRevenue > b.avgRevenue ? a : b))
    : null;
  const worst = observed[0]
    ? observed.reduce((a, b) => (a.avgRevenue < b.avgRevenue ? a : b))
    : null;
  const weakDays = observed.filter((d) => d.isWeakDay);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <span className="text-xs text-muted-foreground">últimos {windowDays} días</span>
      </div>

      {/* Resumen ejecutivo */}
      {!compact && best && worst && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-1">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3 text-primary" />
              <p className="text-xs text-muted-foreground">Mejor día</p>
            </div>
            <p className="text-sm font-semibold text-primary">{best.dayName}</p>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(best.avgRevenue)} • {best.avgTransactions.toFixed(0)} txn
            </p>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
            <div className="flex items-center gap-1.5">
              <TrendingDown className="h-3 w-3 text-destructive" />
              <p className="text-xs text-muted-foreground">Día más débil</p>
            </div>
            <p className="text-sm font-semibold text-destructive">{worst.dayName}</p>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(worst.avgRevenue)} • {worst.avgTransactions.toFixed(0)} txn
            </p>
          </div>
        </div>
      )}

      {/* Barras horizontales por día */}
      <div className="space-y-1.5">
        {data.map((d) => {
          if (d.daysObserved === 0) {
            return (
              <div key={d.dow} className="flex items-center gap-3 py-1 opacity-40">
                <span className="text-xs w-20 shrink-0">{d.dayName}</span>
                <span className="text-xs text-muted-foreground">sin operación</span>
              </div>
            );
          }
          const widthPct = (d.avgRevenue / maxRevenue) * 100;
          const isProfit = d.avgNetMarginPct > 0;
          return (
            <div key={d.dow} className="flex items-center gap-3 py-1">
              <span className={cn("text-xs w-20 shrink-0 font-medium", d.isWeakDay && "text-destructive")}>
                {d.dayName}
              </span>
              <div className="flex-1 h-6 rounded bg-secondary/40 relative overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all",
                    isProfit ? "bg-primary/30" : "bg-destructive/30"
                  )}
                  style={{ width: `${widthPct}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-between px-2 text-xs">
                  <span className="font-medium">{formatCurrency(d.avgRevenue)}</span>
                  <span className={cn("flex items-center gap-1", isProfit ? "text-primary" : "text-destructive")}>
                    {isProfit ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {d.avgNetMarginPct.toFixed(1)}%
                  </span>
                </div>
              </div>
              <span className="text-xs text-muted-foreground w-12 text-right shrink-0">
                {d.avgTransactions.toFixed(0)} txn
              </span>
            </div>
          );
        })}
      </div>

      {/* Conclusión accionable */}
      {!compact && weakDays.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex items-start gap-2">
          <Minus className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-warning leading-relaxed">
            <span className="font-semibold">{weakDays.map((d) => d.dayName).join(" y ")}</span>
            {weakDays.length === 1 ? " es el día" : " son los días"} con menor rendimiento. Considera
            campañas WhatsApp el día anterior o promociones limitadas para impulsar el tráfico.
          </p>
        </div>
      )}
    </div>
  );
}
