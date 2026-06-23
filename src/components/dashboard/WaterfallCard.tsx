import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ArrowDown } from "lucide-react";
import { SectionCard } from "./SectionCard";
import type { RevenueWaterfall } from "@/lib/analytics/revenue-waterfall";

interface Props {
  data: RevenueWaterfall;
}

export function WaterfallCard({ data }: Props) {
  const {
    totalRevenue,
    totalCogs,
    totalFixedExpenses,
    netProfit,
    cogsPctOfRevenue,
    fixedPctOfRevenue,
    netPctOfRevenue,
    categories,
  } = data;

  const netTone = netProfit > 0 ? "text-primary" : "text-destructive";
  const netBg = netProfit > 0 ? "bg-primary/10" : "bg-destructive/10";

  return (
    <SectionCard bodyClassName="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">¿A dónde va tu dinero?</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          De cada <span className="font-semibold text-foreground">$100</span> que vendes este mes
        </p>
      </div>

      {/* Cascada visual: ingresos → COGS → gastos fijos → utilidad */}
      <div className="grid grid-cols-2 gap-2 text-center text-xs md:grid-cols-4">
        <Step label="Ingresos" value={formatCurrency(totalRevenue)} pct="100%" tone="text-foreground" bg="bg-secondary" />
        <Step label="Reposición" value={formatCurrency(totalCogs)} pct={`−$${Math.round(cogsPctOfRevenue)}`} tone="text-warning" bg="bg-warning/10" />
        <Step label="Gastos fijos" value={formatCurrency(totalFixedExpenses)} pct={`−$${Math.round(fixedPctOfRevenue)}`} tone="text-muted-foreground" bg="bg-secondary" />
        <Step label="Utilidad neta" value={formatCurrency(Math.abs(netProfit))} pct={`${netProfit >= 0 ? "" : "−"}$${Math.abs(Math.round(netPctOfRevenue))}`} tone={netTone} bg={netBg} bold />
      </div>

      {/* Barra proporcional */}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Distribución de cada $100</p>
        <div className="flex h-4 rounded-full overflow-hidden">
          <div className="bg-warning/60" style={{ width: `${cogsPctOfRevenue}%` }} title={`Reposición ${cogsPctOfRevenue.toFixed(0)}%`} />
          <div className="bg-muted-foreground/30" style={{ width: `${fixedPctOfRevenue}%` }} title={`Gastos fijos ${fixedPctOfRevenue.toFixed(0)}%`} />
          <div className={cn(netProfit >= 0 ? "bg-primary" : "bg-destructive", "min-w-[2px]")} style={{ width: `${Math.max(Math.abs(netPctOfRevenue), 1)}%` }} title={`Utilidad ${netPctOfRevenue.toFixed(0)}%`} />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Reposición ({cogsPctOfRevenue.toFixed(0)}%)</span>
          <span className="hidden sm:inline">Gastos fijos ({fixedPctOfRevenue.toFixed(0)}%)</span>
          <span className={netTone}>Utilidad ({netPctOfRevenue.toFixed(0)}%)</span>
        </div>
      </div>

      {/* Desglose: reposición por categoría */}
      <div className="space-y-2 pt-2 border-t border-border">
        <div className="flex items-center gap-2">
          <ArrowDown className="h-3.5 w-3.5 text-warning" />
          <p className="text-xs font-semibold">Reposición por categoría</p>
          <span className="ml-auto text-xs text-muted-foreground">{formatCurrency(totalCogs)} total</span>
        </div>
        <div className="space-y-1.5">
          {categories.map((c) => {
            const cogsPct = totalCogs > 0 ? (c.cogs / totalCogs) * 100 : 0;
            return (
              <div key={c.category} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate font-medium">{c.category}</span>
                    <span className="text-muted-foreground shrink-0 hidden sm:inline">{c.revenuePct.toFixed(0)}% ventas</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-muted-foreground">{formatCurrency(c.cogs)}</span>
                    <span className={cn("font-medium w-9 text-right", c.marginPct >= 40 ? "text-primary" : c.marginPct >= 20 ? "text-foreground" : "text-warning")}>
                      {c.marginPct.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full bg-warning/50" style={{ width: `${cogsPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}

function Step({
  label,
  value,
  pct,
  tone,
  bg,
  bold,
}: {
  label: string;
  value: string;
  pct: string;
  tone: string;
  bg: string;
  bold?: boolean;
}) {
  return (
    <div className={cn("rounded-lg p-3 space-y-1", bg)}>
      <p className="text-xs text-muted-foreground uppercase tracking-wider truncate">{label}</p>
      <p className={cn("text-sm tabular-nums", tone, bold && "font-bold")}>{value}</p>
      <p className={cn("text-xs tabular-nums", tone)}>{pct}</p>
    </div>
  );
}
