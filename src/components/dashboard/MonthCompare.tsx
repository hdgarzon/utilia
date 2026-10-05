import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, Calendar } from "lucide-react";
import type { FinancialOverview } from "@/lib/analytics/financial-month";

interface MetricCardProps {
  label: string;
  currentValue: string;
  previousValue: string;
  /** % de cambio; null = sin base para comparar. */
  delta: number | null;
  /** Texto del cambio cuando el % no se lee bien (ej. pesos con pérdida de por medio). */
  deltaText?: string;
  /** Signo para el color cuando se usa `deltaText`. */
  deltaSign?: number;
}

function MetricCompareCard({ label, currentValue, previousValue, delta, deltaText, deltaSign }: MetricCardProps) {
  const sign = deltaText !== undefined ? (deltaSign ?? 0) : delta;
  const isNeutral = sign === null || Math.abs(sign) < 0.5;
  const Icon = isNeutral ? Minus : sign! > 0 ? TrendingUp : TrendingDown;
  const tone = isNeutral ? "text-muted-foreground" : sign! > 0 ? "text-primary" : "text-destructive";

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{currentValue}</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground truncate">vs {previousValue}</p>
        <div className={cn("flex items-center gap-1 text-xs font-medium shrink-0", tone)}>
          <Icon className="h-3 w-3" />
          {deltaText ?? (delta === null ? "sin base" : formatPercent(delta))}
        </div>
      </div>
    </div>
  );
}

/**
 * Mes seleccionado contra el anterior. Con el mes en curso, ambos lados cubren
 * los mismos días (1 al último día cerrado): comparar 4 días contra 5, o
 * desbordar al mes siguiente cuando el anterior es más corto, daba caídas
 * que no existían.
 */
export function MonthCompare({ overview }: { overview: FinancialOverview }) {
  const { current, previous, previousFull, deltas, status } = overview;
  const inProgress = status === "in-progress";
  const hasPrevious = previous.revenue > 0;

  // Con pérdida en alguno de los dos lados el % no dice si mejoraste o solo
  // perdiste menos: se muestra la diferencia en pesos.
  const netDeltaText =
    hasPrevious && deltas.netProfitPct === null
      ? `${deltas.netProfitDiff >= 0 ? "+" : "−"}${formatCurrency(Math.abs(deltas.netProfitDiff))}`
      : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Calendar className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">
          {current.label} vs {previous.label}
        </h2>
        <span className="text-xs text-muted-foreground">
          {inProgress ? `Días 1–${current.daysElapsed} de cada mes` : "Meses completos"}
        </span>
      </div>

      {!hasPrevious && (
        <p className="text-xs text-muted-foreground">Sin ventas registradas en {previous.label} para comparar.</p>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCompareCard
          label="Ventas"
          currentValue={formatCurrency(current.revenue)}
          previousValue={formatCurrency(previous.revenue)}
          delta={deltas.revenuePct}
        />
        <MetricCompareCard
          label="Transacciones"
          currentValue={current.transactions.toLocaleString("es-CO")}
          previousValue={previous.transactions.toLocaleString("es-CO")}
          delta={deltas.transactionsPct}
        />
        <MetricCompareCard
          label="Ticket promedio"
          currentValue={formatCurrency(current.avgTicket)}
          previousValue={formatCurrency(previous.avgTicket)}
          delta={deltas.avgTicketPct}
        />
        <MetricCompareCard
          label="Utilidad neta"
          currentValue={formatCurrency(current.netProfit)}
          previousValue={formatCurrency(previous.netProfit)}
          delta={deltas.netProfitPct}
          deltaText={netDeltaText}
          deltaSign={deltas.netProfitDiff}
        />
      </div>

      {inProgress && previousFull.revenue > 0 && (
        <p className="text-xs text-muted-foreground">
          {previousFull.label} cerró con{" "}
          <span className={cn("font-medium", previousFull.netProfit > 0 ? "text-primary" : "text-destructive")}>
            {formatCurrency(previousFull.netProfit)}
          </span>{" "}
          de utilidad neta ({previousFull.netMarginPct.toFixed(1)}%) sobre {formatCurrency(previousFull.revenue)} en ventas.
        </p>
      )}
    </div>
  );
}
