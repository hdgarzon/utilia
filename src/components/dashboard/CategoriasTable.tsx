"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatCurrency, cn } from "@/lib/utils";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { SortableHeader } from "./table-controls";
import type { CategoryStat } from "@/lib/analytics/categories";
import { Package, AlertTriangle, TrendingUp, ChevronRight, Download } from "lucide-react";

type SortKey = "category" | "productCount" | "totalStock" | "inventoryValue" | "avgMarginPct" | "inventoryROI" | "turnoverRate" | "totalDailySales" | "alerts";

const SENTINEL_NULL = "_sin_categoria";
function categoryHref(rawCategory: string | null): string {
  const slug = rawCategory === null ? SENTINEL_NULL : encodeURIComponent(rawCategory);
  return `/categorias/${slug}`;
}

interface Props {
  stats: CategoryStat[];
}

export function CategoriasTable({ stats }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("inventoryValue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const maxValue = useMemo(() => Math.max(...stats.map((c) => c.inventoryValue)), [stats]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...stats].sort((a, b) => {
      if (sortKey === "category") return a.category.localeCompare(b.category) * dir;
      if (sortKey === "alerts") return ((a.criticalStockCount + a.staleCount) - (b.criticalStockCount + b.staleCount)) * dir;
      return (a[sortKey] - b[sortKey]) * dir;
    });
  }, [stats, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function handleExport() {
    const csv = buildCsv(sorted, [
      { header: "Categoría", value: (c) => c.category },
      { header: "Productos", value: (c) => c.productCount },
      { header: "Productos activos", value: (c) => c.productsWithSales },
      { header: "Stock", value: (c) => Math.round(c.totalStock) },
      { header: "Valor CMP", value: (c) => Math.round(c.inventoryValue) },
      { header: "Margen %", value: (c) => c.avgMarginPct.toFixed(1) },
      { header: "ROI mes %", value: (c) => c.inventoryROI.toFixed(0) },
      { header: "Turnover", value: (c) => c.turnoverRate.toFixed(1) },
      { header: "Vel. venta/día", value: (c) => c.totalDailySales.toFixed(1) },
      { header: "Stock crítico", value: (c) => c.criticalStockCount },
      { header: "Sin rotación", value: (c) => c.staleCount },
    ]);
    downloadCsv(`categorias-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-2">
        <Package className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Detalle por Categoría</h3>
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary transition-colors"
          title="Exportar a CSV"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground bg-secondary/30">
              <SortableHeader label="Categoría" active={sortKey === "category"} dir={sortDir} onClick={() => toggleSort("category")} align="left" />
              <SortableHeader label="Productos" active={sortKey === "productCount"} dir={sortDir} onClick={() => toggleSort("productCount")} />
              <SortableHeader label="Stock" active={sortKey === "totalStock"} dir={sortDir} onClick={() => toggleSort("totalStock")} />
              <SortableHeader label="Valor (CMP)" active={sortKey === "inventoryValue"} dir={sortDir} onClick={() => toggleSort("inventoryValue")} />
              <SortableHeader label="Margen" active={sortKey === "avgMarginPct"} dir={sortDir} onClick={() => toggleSort("avgMarginPct")} />
              <SortableHeader label="ROI mes" active={sortKey === "inventoryROI"} dir={sortDir} onClick={() => toggleSort("inventoryROI")} />
              <th className="px-4 py-2.5 text-right font-medium" title="Rotaciones por año — papelería sana: 6-8">
                <button onClick={() => toggleSort("turnoverRate")} className={cn("inline-flex items-center gap-1 hover:text-foreground transition-colors flex-row-reverse", sortKey === "turnoverRate" && "text-foreground")}>
                  Turnover
                </button>
              </th>
              <SortableHeader label="Vel. venta" active={sortKey === "totalDailySales"} dir={sortDir} onClick={() => toggleSort("totalDailySales")} />
              <th className="px-4 py-2.5 text-center font-medium">
                <button onClick={() => toggleSort("alerts")} className={cn("hover:text-foreground transition-colors", sortKey === "alerts" && "text-foreground")}>
                  Alertas
                </button>
              </th>
              <th className="px-4 py-2.5 text-left font-medium w-32">Peso relativo</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const widthPct = maxValue > 0 ? (c.inventoryValue / maxValue) * 100 : 0;
              const marginTone =
                c.avgMarginPct >= 30 ? "text-primary" : c.avgMarginPct >= 15 ? "text-foreground" : "text-warning";
              return (
                <tr key={c.category} className="border-b border-border last:border-0 hover:bg-secondary/20 group">
                  <td className="px-4 py-3 font-medium max-w-48 truncate">
                    <Link
                      href={categoryHref(c.rawCategory)}
                      className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                    >
                      {c.category}
                      <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.productCount}
                    <span className="text-muted-foreground ml-1">({c.productsWithSales} act.)</span>
                  </td>
                  <td className="px-4 py-3 text-right">{Math.round(c.totalStock).toLocaleString("es-CO")}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(c.inventoryValue)}</td>
                  <td className={cn("px-4 py-3 text-right font-medium", marginTone)}>
                    {c.avgMarginPct.toFixed(1)}%
                  </td>
                  <td className={cn(
                    "px-4 py-3 text-right font-medium",
                    c.inventoryROI >= 30 ? "text-primary" : c.inventoryROI >= 15 ? "text-foreground" : "text-warning"
                  )}>
                    {c.inventoryROI > 0 ? `${c.inventoryROI.toFixed(0)}%` : "—"}
                  </td>
                  <td className={cn(
                    "px-4 py-3 text-right font-medium",
                    c.turnoverRate >= 6 ? "text-primary" : c.turnoverRate >= 3 ? "text-foreground" : "text-warning"
                  )} title={c.turnoverRate > 0 ? `~${Math.round(c.daysOfStockAvg)} días de stock promedio` : ""}>
                    {c.turnoverRate > 0 ? `${c.turnoverRate.toFixed(1)}x` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.totalDailySales > 0 ? (
                      <span className="flex items-center justify-end gap-1 text-primary">
                        <TrendingUp className="h-3 w-3" />
                        {c.totalDailySales.toFixed(1)}/día
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {c.criticalStockCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive font-medium">
                          <AlertTriangle className="h-3 w-3" />
                          {c.criticalStockCount}
                        </span>
                      )}
                      {c.staleCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-warning font-medium">
                          {c.staleCount} sin rot.
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-2 w-full rounded-full bg-secondary/40 overflow-hidden">
                      <div
                        className="h-full bg-primary/50 rounded-full transition-all"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
