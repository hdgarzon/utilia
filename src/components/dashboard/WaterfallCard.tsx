import Link from "next/link";
import { cn, formatCurrency, formatMonthLabel, MONTH_NAMES } from "@/lib/utils";
import { ArrowDown, ChevronRight, Receipt } from "lucide-react";
import { SectionCard } from "./SectionCard";
import type { CategoryCost, MonthPnL } from "@/lib/analytics/financial-month";

interface Props {
  pnl: MonthPnL;
  categories: CategoryCost[];
}

const MAX_FIXED_ITEMS = 6;

/**
 * Cascada del dinero del período: ingresos → costo de la mercancía → utilidad
 * bruta → gastos fijos → utilidad neta, con el desglose real por categoría
 * (CategorySnapshot de los mismos días) y por concepto de gasto fijo.
 */
export function WaterfallCard({ pnl, categories }: Props) {
  const { revenue, cost, grossProfit, fixedCharged, netProfit, fixed, daysElapsed, daysInMonth } = pnl;
  const pctOf = (v: number) => (revenue > 0 ? (v / revenue) * 100 : 0);
  const cogsPct = pctOf(cost);
  const grossPct = pctOf(grossProfit);
  const fixedPct = pctOf(fixedCharged);
  const netPct = pctOf(netProfit);
  const inProgress = daysElapsed < daysInMonth;
  const netTone = netProfit > 0 ? "text-primary" : "text-destructive";

  // Si hay pérdida, los costos suman más de 100: la barra se normaliza al total.
  const barTotal = Math.max(100, cogsPct + fixedPct);
  const width = (v: number) => `${(Math.max(v, 0) / barTotal) * 100}%`;

  const catCost = categories.reduce((s, c) => s + c.cost, 0);
  const catGap = cost > 0 ? Math.abs(catCost - cost) / cost : 0;

  const topFixed = fixed.items.slice(0, MAX_FIXED_ITEMS);
  const restFixed = fixed.items.slice(MAX_FIXED_ITEMS);
  const restFixedTotal = restFixed.reduce((s, i) => s + i.amount, 0);
  const fixedShare = (amount: number) => (fixed.monthly > 0 ? (amount / fixed.monthly) * 100 : 0);

  const periodText = inProgress
    ? `del 1 al ${daysElapsed} de ${MONTH_NAMES[pnl.month - 1].toLowerCase()}`
    : `en ${pnl.label}`;

  return (
    <SectionCard bodyClassName="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">¿A dónde va tu dinero?</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          De cada <span className="font-semibold text-foreground">$100</span> que vendiste {periodText}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-xs md:grid-cols-5 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
        <Step label="Ventas" value={revenue} pct="$100" tone="text-foreground" bg="bg-secondary" />
        <Step label="Mercancía" value={-cost} pct={`−$${Math.round(cogsPct)}`} tone="text-warning" bg="bg-warning/10" />
        <Step label="Utilidad bruta" value={grossProfit} pct={`$${Math.round(grossPct)}`} tone="text-foreground" bg="bg-secondary" />
        <Step label="Gastos fijos" value={-fixedCharged} pct={`−$${Math.round(fixedPct)}`} tone="text-muted-foreground" bg="bg-secondary" />
        <Step
          label="Utilidad neta"
          value={netProfit}
          pct={`${netProfit < 0 ? "−" : ""}$${Math.abs(Math.round(netPct))}`}
          tone={netTone}
          bg={netProfit > 0 ? "bg-primary/10" : "bg-destructive/10"}
          bold
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex h-4 rounded-full overflow-hidden bg-secondary">
          <div className="bg-warning/60" style={{ width: width(cogsPct) }} title={`Mercancía ${cogsPct.toFixed(0)}%`} />
          <div className="bg-muted-foreground/30" style={{ width: width(fixedPct) }} title={`Gastos fijos ${fixedPct.toFixed(0)}%`} />
          {netPct > 0 && <div className="bg-primary" style={{ width: width(netPct) }} title={`Utilidad ${netPct.toFixed(0)}%`} />}
        </div>
        <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
          <span>Mercancía {cogsPct.toFixed(0)}%</span>
          <span>Gastos fijos {fixedPct.toFixed(0)}%</span>
          <span className={netTone}>
            {netPct >= 0 ? `Utilidad ${netPct.toFixed(0)}%` : `Los costos superan las ventas en ${Math.abs(netPct).toFixed(0)}%`}
          </span>
        </div>
      </div>

      <div className="grid gap-5 pt-3 border-t border-border lg:grid-cols-2">
        {/* Costo de la mercancía vendida, por categoría */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ArrowDown className="h-3.5 w-3.5 text-warning" />
            <p className="text-xs font-semibold">Mercancía por categoría</p>
            <span className="ml-auto text-xs text-muted-foreground">margen bruto</span>
          </div>
          {categories.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin detalle por categoría para estos días.</p>
          ) : (
            <div className="space-y-1.5">
              {categories.map((c) => (
                <div key={c.category} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-medium">{c.category}</span>
                      <span className="text-muted-foreground shrink-0 hidden sm:inline">{c.revenueSharePct.toFixed(0)}% de ventas</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-muted-foreground tabular-nums">{formatCurrency(c.cost)}</span>
                      <span
                        className={cn(
                          "font-medium w-9 text-right tabular-nums",
                          c.marginPct >= 40 ? "text-primary" : c.marginPct >= 20 ? "text-foreground" : "text-warning"
                        )}
                      >
                        {c.marginPct.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full bg-warning/50" style={{ width: `${c.costSharePct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {catGap > 0.01 && (
            <p className="text-xs text-muted-foreground italic">
              El desglose por categoría suma {formatCurrency(catCost)} y el total del período es {formatCurrency(cost)}: la
              historia por categoría se cargó aparte y no cuadra exacto con el total diario.
            </p>
          )}
        </div>

        {/* Gastos fijos por concepto */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold">Gastos fijos por concepto</p>
            <Link href="/presupuestos" className="ml-auto flex items-center text-xs text-primary hover:underline">
              Presupuestos <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {fixed.source === "none" ? (
            <p className="text-xs text-destructive">
              Sin presupuesto de gastos fijos: la utilidad neta no descuenta arriendo, nómina ni servicios.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(fixed.monthly)} al mes
                {inProgress && <> · {formatCurrency(fixedCharged)} cargados en {daysElapsed} de {daysInMonth} días</>}
                {fixed.source === "inherited" && fixed.from && (
                  <> · <span className="text-warning">heredado de {formatMonthLabel(fixed.from.year, fixed.from.month)}</span></>
                )}
              </p>
              <div className="space-y-1.5">
                {topFixed.map((i) => (
                  <FixedRow key={i.category} label={i.category} amount={i.amount} share={fixedShare(i.amount)} />
                ))}
                {restFixed.length > 0 && (
                  <FixedRow label={`Otros (${restFixed.length})`} amount={restFixedTotal} share={fixedShare(restFixedTotal)} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function FixedRow({ label, amount, share }: { label: string; amount: number; share: number }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums shrink-0">{formatCurrency(amount)}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
        <div className="h-full rounded-full bg-muted-foreground/40" style={{ width: `${share}%` }} />
      </div>
    </div>
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
  value: number;
  pct: string;
  tone: string;
  bg: string;
  bold?: boolean;
}) {
  return (
    <div className={cn("rounded-lg p-3 space-y-1", bg)}>
      <p className="text-xs text-muted-foreground uppercase tracking-wider truncate">{label}</p>
      <p className={cn("text-sm tabular-nums", tone, bold && "font-bold")}>
        {value < 0 ? "−" : ""}
        {formatCurrency(Math.abs(value))}
      </p>
      <p className={cn("text-xs tabular-nums", tone)}>{pct}</p>
    </div>
  );
}
