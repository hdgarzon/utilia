import { cn, formatCurrency } from "@/lib/utils";
import { Flame, TrendingUp, TrendingDown, Calendar, Wallet } from "lucide-react";
import { CashBalanceEditor } from "./CashBalanceEditor";
import type { CashFlowAnalysis } from "@/lib/analytics/cash-flow";

interface Props {
  data: CashFlowAnalysis;
}

export function CashFlowCard({ data }: Props) {
  const {
    cashBalance,
    cashBalanceUpdatedAt,
    avgMonthlyRevenue,
    avgMonthlyGrossProfit,
    avgMonthlyFixedExpenses,
    avgMonthlyNetProfit,
    burnRateMonthly,
    isBurning,
    runwayMonths,
    lowConfidence,
    balanceStale,
    daysSinceBalanceUpdate,
    projected30dCash,
    projected90dCash,
    daysObserved,
  } = data;

  const noCashSet = cashBalance === 0 && cashBalanceUpdatedAt === null;
  const runwayTone =
    !isBurning ? "text-primary" :
    runwayMonths === null ? "text-muted-foreground" :
    runwayMonths < 3 ? "text-destructive" :
    runwayMonths < 6 ? "text-warning" :
    "text-foreground";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* Saldo actual editable */}
        <CashBalanceEditor currentBalance={cashBalance} updatedAt={cashBalanceUpdatedAt} />

        {/* Burn rate */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <div className="flex items-center gap-1.5">
            {isBurning ? (
              <Flame className="h-3.5 w-3.5 text-destructive" />
            ) : (
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
            )}
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              {isBurning ? "Burn Rate / mes" : "Excedente / mes"}
            </p>
          </div>
          <p className={cn("text-2xl font-bold", isBurning ? "text-destructive" : "text-primary")}>
            {formatCurrency(Math.abs(burnRateMonthly))}
          </p>
          <p className="text-xs text-muted-foreground">
            {isBurning
              ? "Lo que falta cubrir con caja"
              : "Te queda cada mes después de gastos fijos"}
          </p>
        </div>

        {/* Runway */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Runway</p>
          </div>
          {noCashSet ? (
            <>
              <p className="text-sm font-medium text-muted-foreground">Configura tu saldo</p>
              <p className="text-xs text-muted-foreground">→ click en el lápiz del Saldo</p>
            </>
          ) : !isBurning ? (
            <>
              <p className="text-2xl font-bold text-primary">∞</p>
              <p className="text-xs text-muted-foreground">Operación rentable, sin riesgo</p>
            </>
          ) : balanceStale ? (
            <>
              <p className="text-sm font-medium text-muted-foreground">Saldo desactualizado</p>
              <p className="text-xs text-muted-foreground">
                hace {daysSinceBalanceUpdate}d → actualízalo para calcular el runway
              </p>
            </>
          ) : lowConfidence ? (
            <>
              <p className="text-sm font-medium text-muted-foreground">Datos insuficientes</p>
              <p className="text-xs text-muted-foreground">
                {daysObserved}d de historia · runway confiable desde {14}d
              </p>
            </>
          ) : (
            <>
              <p className={cn("text-2xl font-bold", runwayTone)}>
                {runwayMonths!.toFixed(1)} <span className="text-sm">meses</span>
              </p>
              <p className="text-xs text-muted-foreground">
                hasta {new Date(Date.now() + runwayMonths! * 30 * 86400000).toLocaleDateString("es-CO", { month: "short", year: "numeric" })}
              </p>
            </>
          )}
        </div>

        {/* Proyección 30/90d */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <div className="flex items-center gap-1.5">
            {avgMonthlyNetProfit >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-destructive" />
            )}
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Proyección 30d</p>
          </div>
          <p className={cn("text-2xl font-bold", projected30dCash >= cashBalance ? "text-primary" : "text-destructive")}>
            {formatCurrency(projected30dCash)}
          </p>
          <p className="text-xs text-muted-foreground">90d: {formatCurrency(projected90dCash)}</p>
        </div>
      </div>

      {/* Detalle de ingresos/gastos mensuales */}
      <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Flujo Operativo Mensual (promedio últimos {daysObserved}d)</h3>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 text-sm">
          <Row label="Ingresos" value={avgMonthlyRevenue} positive />
          <Row label="Utilidad bruta" value={avgMonthlyGrossProfit} positive={avgMonthlyGrossProfit >= 0} />
          <Row label="Gastos fijos" value={-avgMonthlyFixedExpenses} negative />
          <Row label="Resultado neto" value={avgMonthlyNetProfit} positive={avgMonthlyNetProfit >= 0} bold />
        </div>
        {daysObserved < 14 && (
          <p className="text-xs text-warning">
            ⚠ Solo {daysObserved} días observados. La proyección será más confiable después de 30d con data.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  positive,
  negative,
  bold,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
  bold?: boolean;
}) {
  const tone = positive ? "text-primary" : negative ? "text-destructive" : value < 0 ? "text-destructive" : "text-foreground";
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn(bold ? "text-lg font-bold" : "text-sm font-semibold", tone)}>
        {value < 0 ? "-" : ""}
        {formatCurrency(Math.abs(value))}
      </p>
    </div>
  );
}
