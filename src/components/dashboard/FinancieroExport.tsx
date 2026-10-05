"use client";

import { useRef } from "react";
import { ChevronDown, Download } from "lucide-react";
import { buildCsv, downloadCsv } from "@/lib/csv";
import type { CategoryCost, DailyFinancialRow, SummaryRow } from "@/lib/analytics/financial-month";

interface Props {
  /** "2026-10", para el nombre de los archivos. */
  period: string;
  days: DailyFinancialRow[];
  categories: CategoryCost[];
  summary: SummaryRow[];
}

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const weekday = (isoDate: string) => WEEKDAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
const pct = (part: number, total: number) => (total > 0 ? ((part / total) * 100).toFixed(1) : "0.0");

/** Descarga las cifras del período: detalle diario, por categoría y resumen. */
export function FinancieroExport({ period, days, categories, summary }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);

  function exportDaily() {
    const csv = buildCsv(days, [
      { header: "Fecha", value: (d) => d.date },
      { header: "Día", value: (d) => weekday(d.date) },
      { header: "Ventas", value: (d) => Math.round(d.revenue) },
      { header: "Costo mercancía", value: (d) => Math.round(d.cost) },
      { header: "Utilidad bruta", value: (d) => Math.round(d.grossProfit) },
      { header: "Margen bruto %", value: (d) => pct(d.grossProfit, d.revenue) },
      { header: "Gasto fijo asignado", value: (d) => Math.round(d.fixedExpense) },
      { header: "Utilidad neta", value: (d) => Math.round(d.netProfit) },
      { header: "Transacciones", value: (d) => d.transactions },
      { header: "Ticket promedio", value: (d) => (d.transactions > 0 ? Math.round(d.revenue / d.transactions) : 0) },
    ]);
    downloadCsv(`financiero-diario-${period}.csv`, csv);
  }

  function exportCategories() {
    const csv = buildCsv(categories, [
      { header: "Categoría", value: (c) => c.category },
      { header: "Ventas", value: (c) => Math.round(c.revenue) },
      { header: "Costo mercancía", value: (c) => Math.round(c.cost) },
      { header: "Utilidad bruta", value: (c) => Math.round(c.grossProfit) },
      { header: "Margen bruto %", value: (c) => c.marginPct.toFixed(1) },
      { header: "% de las ventas", value: (c) => c.revenueSharePct.toFixed(1) },
      { header: "% del costo", value: (c) => c.costSharePct.toFixed(1) },
    ]);
    downloadCsv(`financiero-categorias-${period}.csv`, csv);
  }

  function exportSummary() {
    const csv = buildCsv(summary, [
      { header: "Concepto", value: (r) => r.concepto },
      { header: "Valor", value: (r) => r.valor },
    ]);
    downloadCsv(`financiero-resumen-${period}.csv`, csv);
  }

  function run(action: () => void) {
    action();
    if (menu.current) menu.current.open = false;
  }

  return (
    <details ref={menu} className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary transition-colors [&::-webkit-details-marker]:hidden">
        <Download className="h-3.5 w-3.5" />
        Exportar CSV
        <ChevronDown className="h-3 w-3" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-border bg-card p-1 shadow-lg">
        <MenuItem label="Resumen del período" hint="Totales, proyección, mes anterior y gastos fijos" onClick={() => run(exportSummary)} />
        <MenuItem label="Detalle diario" hint="Ventas, costo, gasto fijo y utilidad de cada día" onClick={() => run(exportDaily)} />
        <MenuItem label="Por categoría" hint="Ventas, costo y margen de cada categoría" onClick={() => run(exportCategories)} />
      </div>
    </details>
  );
}

function MenuItem({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full rounded-md px-2.5 py-2 text-left hover:bg-secondary transition-colors">
      <p className="text-xs font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </button>
  );
}
