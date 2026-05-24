import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, Calendar } from "lucide-react";
import type { MonthComparison } from "@/lib/analytics/month-compare";

interface Props {
  data: MonthComparison;
}

interface MetricCardProps {
  label: string;
  currentValue: string;
  previousValue: string;
  delta: number;
  inverse?: boolean; // si true, baja es buena (ej: costos)
  isPercent?: boolean; // si el delta es en pp en vez de %
}

function MetricCompareCard({ label, currentValue, previousValue, delta, inverse, isPercent }: MetricCardProps) {
  const isNeutral = Math.abs(delta) < 0.5;
  const isPositive = isNeutral ? false : inverse ? delta < 0 : delta > 0;
  const Icon = isNeutral ? Minus : isPositive ? TrendingUp : TrendingDown;
  const tone = isNeutral
    ? "text-muted-foreground"
    : isPositive
    ? "text-primary"
    : "text-destructive";

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold">{currentValue}</p>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">vs {previousValue}</p>
        <div className={cn("flex items-center gap-1 text-xs font-medium", tone)}>
          <Icon className="h-3 w-3" />
          {isPercent ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp` : formatPercent(delta)}
        </div>
      </div>
    </div>
  );
}

export function MonthCompare({ data }: Props) {
  const { currentMTD, previousMTD, current, previous, deltas } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">
          {current.label} vs {previous.label}
        </h2>
        <span className="text-xs text-muted-foreground">
          MTD: {currentMTD.daysWithData} días vs {previousMTD.daysWithData} días
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCompareCard
          label="Ingresos MTD"
          currentValue={formatCurrency(currentMTD.totalRevenue)}
          previousValue={formatCurrency(previousMTD.totalRevenue)}
          delta={deltas.revenue}
        />
        <MetricCompareCard
          label="Transacciones MTD"
          currentValue={currentMTD.totalTransactions.toLocaleString("es-CO")}
          previousValue={previousMTD.totalTransactions.toLocaleString("es-CO")}
          delta={deltas.transactions}
        />
        <MetricCompareCard
          label="Ticket Promedio MTD"
          currentValue={formatCurrency(currentMTD.avgTicket)}
          previousValue={formatCurrency(previousMTD.avgTicket)}
          delta={deltas.avgTicket}
        />
        <MetricCompareCard
          label="Utilidad Neta MTD"
          currentValue={formatCurrency(currentMTD.netProfit)}
          previousValue={formatCurrency(previousMTD.netProfit)}
          delta={deltas.netProfit}
        />
      </div>

      {/* Resumen del mes cerrado */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          Mes anterior cerrado — {previous.label}
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 xl:grid-cols-4 text-sm">
          <div className="flex justify-between border-b border-border pb-1.5">
            <span className="text-muted-foreground">Ingresos totales</span>
            <span className="font-medium">{formatCurrency(previous.totalRevenue)}</span>
          </div>
          <div className="flex justify-between border-b border-border pb-1.5">
            <span className="text-muted-foreground">Costos</span>
            <span className="font-medium">{formatCurrency(previous.totalCost)}</span>
          </div>
          <div className="flex justify-between border-b border-border pb-1.5">
            <span className="text-muted-foreground">Utilidad bruta</span>
            <span className="font-medium text-primary">{formatCurrency(previous.grossProfit)}</span>
          </div>
          <div className="flex justify-between border-b border-border pb-1.5">
            <span className="text-muted-foreground">Gastos fijos</span>
            <span className="font-medium">{formatCurrency(previous.totalFixedExpenses)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Utilidad neta</span>
            <span className={cn("font-semibold", previous.netProfit >= 0 ? "text-primary" : "text-destructive")}>
              {formatCurrency(previous.netProfit)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Margen neto</span>
            <span className={cn("font-semibold", previous.netMarginPct >= 15 ? "text-primary" : previous.netMarginPct >= 0 ? "text-warning" : "text-destructive")}>
              {previous.netMarginPct.toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Transacciones</span>
            <span className="font-medium">{previous.totalTransactions.toLocaleString("es-CO")}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ticket promedio</span>
            <span className="font-medium">{formatCurrency(previous.avgTicket)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
