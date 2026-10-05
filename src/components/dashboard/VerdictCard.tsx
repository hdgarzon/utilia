import type { ReactNode } from "react";
import { cn, formatCurrency, MONTH_NAMES } from "@/lib/utils";
import { TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { HEALTHY_NET_MARGIN_PCT, type FinancialOverview } from "@/lib/analytics/financial-month";

const TONES = {
  good: { text: "text-primary", bg: "bg-primary/5", border: "border-primary/40", Icon: CheckCircle2 },
  thin: { text: "text-warning", bg: "bg-warning/5", border: "border-warning/40", Icon: AlertTriangle },
  loss: { text: "text-destructive", bg: "bg-destructive/5", border: "border-destructive/40", Icon: TrendingDown },
};

const TITLES = {
  open: { good: "Sí, vas ganando", thin: "Vas ganando, pero ajustado", loss: "Vas en pérdida este mes" },
  closed: { good: "Cerró ganando", thin: "Cerró ganando, pero ajustado", loss: "Cerró en pérdida" },
};

/**
 * Responde "¿estamos ganando?" con la utilidad neta REAL de los días cerrados
 * (gasto fijo cobrado por día calendario) y, si el mes sigue abierto, la
 * proyección de cierre como dato secundario. Con el gasto fijo prorrateado por
 * día calendario el margen real y el proyectado coinciden, así que el semáforo
 * no salta de un criterio a otro a mitad de mes.
 */
export function VerdictCard({ overview }: { overview: FinancialOverview }) {
  const { current, previous, deltas, projection, status } = overview;
  const open = status === "in-progress";
  const tier = current.netProfit <= 0 ? "loss" : current.netMarginPct < HEALTHY_NET_MARGIN_PCT ? "thin" : "good";
  const tone = TONES[tier];
  const margin = Math.abs(current.netMarginPct).toFixed(0);
  const sameDays = open ? ` (días 1–${previous.daysElapsed})` : "";

  let deltaNode: ReactNode = null;
  if (previous.revenue > 0) {
    const up = deltas.netProfitDiff >= 0;
    const text =
      deltas.netProfitPct !== null
        ? `${up ? "▲" : "▼"} ${Math.abs(deltas.netProfitPct).toFixed(0)}%`
        : `${up ? "+" : "−"}${formatCurrency(Math.abs(deltas.netProfitDiff))}`;
    deltaNode = (
      <>
        <span className={cn("font-medium", up ? "text-primary" : "text-destructive")}>{text}</span>{" "}
        vs {previous.label}
        {sameDays}
      </>
    );
  }

  return (
    <div className={cn("rounded-xl border p-5", tone.border, tone.bg)}>
      <div className="flex items-start gap-3">
        <tone.Icon className={cn("h-6 w-6 mt-0.5 shrink-0", tone.text)} />
        <div className="flex-1 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            {open ? "¿Estamos ganando este mes?" : `¿Cómo cerró ${current.label}?`}
          </p>
          <p className={cn("text-lg font-bold", tone.text)}>{TITLES[open ? "open" : "closed"][tier]}</p>
          <p className={cn("text-3xl font-bold tabular-nums", tone.text)}>{formatCurrency(current.netProfit)}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Utilidad neta {open ? `del 1 al ${current.daysElapsed} de ${MONTH_NAMES[current.month - 1].toLowerCase()}` : "del mes"}.{" "}
            {current.netProfit > 0 ? (
              <>
                De cada $100 que {open ? "vendes te quedan" : "vendiste te quedaron"}{" "}
                <span className="font-semibold text-foreground">${margin}</span>
              </>
            ) : (
              <>
                Por cada $100 que {open ? "vendes pierdes" : "vendiste perdiste"}{" "}
                <span className="font-semibold text-destructive">${margin}</span>
              </>
            )}{" "}
            después de mercancía y gastos fijos.
            {deltaNode && <> · {deltaNode}</>}
          </p>
        </div>
      </div>

      {projection && (
        <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Cierre proyectado · utilidad neta</p>
            <p className={cn("text-sm font-semibold tabular-nums", projection.projectedNetProfit > 0 ? "text-primary" : "text-destructive")}>
              {formatCurrency(projection.projectedNetProfit)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cierre proyectado · ventas</p>
            <p className="text-sm font-semibold tabular-nums">{formatCurrency(projection.projectedRevenue)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Base de la proyección</p>
            <p className="text-sm font-semibold">
              {projection.daysElapsed} de {projection.daysInMonth} días
            </p>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-3">
            Ritmo de venta por día calendario (los días cerrados cuentan como cero) y el gasto fijo del mes completo.
            {projection.lowConfidence && " Con menos de una semana de datos, tómala solo como referencia."}
          </p>
        </div>
      )}
    </div>
  );
}
