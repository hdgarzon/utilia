export const dynamic = 'force-dynamic';

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { VerdictCard } from "@/components/dashboard/VerdictCard";
import { WaterfallCard } from "@/components/dashboard/WaterfallCard";
import { MonthCompare } from "@/components/dashboard/MonthCompare";
import { FinancialDailyChart } from "@/components/dashboard/FinancialDailyChart";
import { BreakevenCard } from "@/components/dashboard/BreakevenCard";
import { FinancieroExport } from "@/components/dashboard/FinancieroExport";
import {
  buildSummaryRows,
  getDataCutoff,
  getFinancialOverview,
  getTrailingActivity,
  type FinancialOverview,
} from "@/lib/analytics/financial-month";
import { getBreakevenAnalysis } from "@/lib/analytics/breakeven";
import { getMonthFixedExpenses } from "@/lib/fixed-expenses";
import { colombiaDaysAgo, daysInMonth } from "@/lib/timezone";
import { getSelectedPeriod } from "@/lib/period";
import { formatCurrency, formatMonthLabel } from "@/lib/utils";

/** Fecha DATE (medianoche UTC) como "4 oct". */
const shortDay = (d: Date) =>
  d.toLocaleDateString("es-CO", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Punto de equilibrio: describe el negocio HOY (venta en vivo contra el gasto
 * fijo mensual vigente), así que solo se muestra en el mes actual.
 */
async function getTodayBreakeven(year: number, month: number, cutoff: Date) {
  const [trailing, fixed] = await Promise.all([getTrailingActivity(cutoff), getMonthFixedExpenses(year, month)]);
  return getBreakevenAnalysis({ fixedExpensesMonthly: fixed.monthly, daysInMonth: daysInMonth(year, month), trailing });
}

function periodStatusText(o: FinancialOverview, isCurrentPeriod: boolean): string {
  const { current } = o;
  if (o.status === "closed") return `Mes cerrado · ${current.daysInMonth} días.`;
  if (o.status === "in-progress") {
    return `Cifras al cierre del ${shortDay(o.cutoff)} · ${current.daysElapsed} de ${current.daysInMonth} días. Hoy entra cuando termine el día.`;
  }
  return isCurrentPeriod ? "Aún no hay días cerrados este mes." : "Este mes aún no tiene datos.";
}

export default async function FinancieroPage() {
  const { month, year, isCurrentPeriod } = await getSelectedPeriod();
  const yesterday = colombiaDaysAgo(1);
  const cutoff = await getDataCutoff().catch(() => yesterday);

  const [overview, breakeven] = await Promise.all([
    getFinancialOverview(year, month, cutoff).catch(() => null),
    isCurrentPeriod ? getTodayBreakeven(year, month, cutoff).catch(() => null) : Promise.resolve(null),
  ]);

  const label = formatMonthLabel(year, month);
  const fixed = overview?.current.fixed;
  const syncBehind = isCurrentPeriod && cutoff < yesterday;
  const period = `${year}-${String(month).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">
            Centro Financiero{!isCurrentPeriod && <span className="text-muted-foreground font-normal"> — {label}</span>}
          </h1>
          {overview && <p className="text-xs text-muted-foreground mt-0.5">{periodStatusText(overview, isCurrentPeriod)}</p>}
        </div>
        {overview && overview.current.daysElapsed > 0 && (
          <FinancieroExport
            period={period}
            days={overview.current.days}
            categories={overview.categories}
            summary={buildSummaryRows(overview)}
          />
        )}
      </div>

      {syncBehind && (
        <Notice tone="warning" icon={<CalendarClock className="h-4 w-4" />}>
          El último sync de ventas completo llega hasta el {shortDay(cutoff)}: faltan días por cargar. Sincroniza para ver las cifras al día.
        </Notice>
      )}

      {overview && fixed && overview.current.daysElapsed > 0 && fixed.source !== "budget" && (
        <Notice tone={fixed.source === "none" ? "danger" : "warning"} icon={<AlertTriangle className="h-4 w-4" />}>
          {fixed.source === "inherited" && fixed.from ? (
            <>
              {label} no tiene presupuesto de gastos fijos propio: se usa el de{" "}
              {formatMonthLabel(fixed.from.year, fixed.from.month)} ({formatCurrency(fixed.monthly)} al mes).{" "}
            </>
          ) : (
            <>No hay presupuesto de gastos fijos: la utilidad neta no descuenta arriendo, nómina ni servicios. </>
          )}
          <Link href={`/presupuestos?year=${year}&month=${month}`} className="font-medium underline underline-offset-2">
            Revisar en Presupuestos
          </Link>
        </Notice>
      )}

      {!overview ? (
        <Notice tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>
          No se pudieron cargar las cifras de {label}. Intenta de nuevo en unos minutos.
        </Notice>
      ) : overview.status === "empty" ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {isCurrentPeriod
            ? `${label} empieza hoy: las cifras del mes aparecen cuando cierre el primer día.`
            : `No hay ventas registradas en ${label}.`}
        </div>
      ) : (
        <>
          <VerdictCard overview={overview} />
          <WaterfallCard pnl={overview.current} categories={overview.categories} />
          <MonthCompare overview={overview} />
          <FinancialDailyChart
            title="Ventas y utilidad bruta por día"
            fixedDaily={overview.current.fixedDaily}
            data={overview.current.days.map((d) => ({
              day: Number(d.date.slice(8)),
              revenue: d.revenue,
              grossProfit: d.grossProfit,
            }))}
          />
        </>
      )}

      {breakeven && <BreakevenCard data={breakeven} />}
    </div>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: "warning" | "danger";
  icon: ReactNode;
  children: ReactNode;
}) {
  const styles =
    tone === "danger"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : "border-warning/40 bg-warning/5 text-warning";
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-xs leading-relaxed ${styles}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="text-foreground">{children}</p>
    </div>
  );
}
