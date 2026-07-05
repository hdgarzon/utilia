"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatCurrency, cn } from "@/lib/utils";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { FilterChip, SortableHeader } from "./table-controls";
import type { OTBCategory, CoverageBrake } from "@/lib/analytics/open-to-buy";
import { ShoppingBag, ChevronRight, AlertTriangle, Zap, Minus, Download } from "lucide-react";

type SortKey = "category" | "salesParticipationPct" | "reinvestmentShare" | "currentCoverageDays" | "unitsToBuy" | "estimatedInvestment" | "adjustedInvestment" | "estimatedROI";
type BrakeFilter = "all" | CoverageBrake;

const SENTINEL_NULL = "_sin_categoria";
function categoryHref(rawCategory: string | null): string {
  const slug = rawCategory === null ? SENTINEL_NULL : encodeURIComponent(rawCategory);
  return `/categorias/${slug}`;
}

function BrakeBadge({ brake }: { brake: CoverageBrake }) {
  if (brake === "urgente") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive font-semibold text-xs whitespace-nowrap">
      <Zap className="h-2.5 w-2.5" /> Urgente
    </span>
  );
  if (brake === "freno") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-warning font-semibold text-xs whitespace-nowrap">
      <AlertTriangle className="h-2.5 w-2.5" /> Freno
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-muted-foreground text-xs whitespace-nowrap">
      <Minus className="h-2.5 w-2.5" /> Normal
    </span>
  );
}

interface Props {
  categories: OTBCategory[];
}

export function ComprasTable({ categories }: Props) {
  const [brakeFilter, setBrakeFilter] = useState<BrakeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("salesParticipationPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const out = brakeFilter === "all" ? categories : categories.filter((c) => c.coverageBrake === brakeFilter);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      if (sortKey === "category") return a.category.localeCompare(b.category) * dir;
      return (a[sortKey] - b[sortKey]) * dir;
    });
  }, [categories, brakeFilter, sortKey, sortDir]);

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
      { header: "% Ventas", value: (c) => c.salesParticipationPct.toFixed(1) },
      { header: "Fondo asignado", value: (c) => Math.round(c.reinvestmentShare) },
      { header: "Cobertura actual (días)", value: (c) => c.currentCoverageDays.toFixed(0) },
      { header: "Señal", value: (c) => c.coverageBrake },
      { header: "Unidades a comprar", value: (c) => Math.round(c.unitsToBuy) },
      { header: "Inversión OTB", value: (c) => Math.round(c.estimatedInvestment) },
      { header: "Inversión ajustada", value: (c) => Math.round(c.adjustedInvestment) },
      { header: "ROI %", value: (c) => c.estimatedROI.toFixed(0) },
    ]);
    downloadCsv(`plan-compras-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const counts = useMemo(() => {
    const c = { urgente: 0, normal: 0, freno: 0 };
    for (const cat of categories) c[cat.coverageBrake]++;
    return c;
  }, [categories]);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 md:px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
        <ShoppingBag className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Distribución del Capital por Categoría</h3>
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary transition-colors"
          title="Exportar orden de compra a CSV"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </button>
      </div>

      <div className="px-4 md:px-5 py-3 flex flex-wrap items-center gap-1.5 border-b border-border">
        <FilterChip label="Todas" active={brakeFilter === "all"} onClick={() => setBrakeFilter("all")} />
        <FilterChip label={`Urgente (${counts.urgente})`} active={brakeFilter === "urgente"} onClick={() => setBrakeFilter("urgente")} tone="critical" />
        <FilterChip label={`Normal (${counts.normal})`} active={brakeFilter === "normal"} onClick={() => setBrakeFilter("normal")} />
        <FilterChip label={`Freno (${counts.freno})`} active={brakeFilter === "freno"} onClick={() => setBrakeFilter("freno")} tone="warning" />
      </div>

      {/* Mobile: tarjetas apiladas — la tabla completa no cabe en pantalla angosta */}
      <div className="md:hidden divide-y divide-border">
        {sorted.map((c) => (
          <Link key={c.category} href={categoryHref(c.rawCategory)} className="block p-4 space-y-2 hover:bg-secondary/20 active:bg-secondary/30">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{c.category}</span>
              <BrakeBadge brake={c.coverageBrake} />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <div>
                <p className="text-muted-foreground">Unidades a comprar</p>
                <p className="font-semibold">{Math.round(c.unitsToBuy).toLocaleString("es-CO")}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Inversión ajustada</p>
                <p className="font-semibold">{formatCurrency(c.adjustedInvestment)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Cobertura actual</p>
                <p className={cn(c.coverageBrake === "urgente" ? "text-destructive font-medium" : c.coverageBrake === "freno" ? "text-warning font-medium" : "font-medium")}>
                  {c.currentCoverageDays.toFixed(0)}d
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">ROI</p>
                <p className={cn("font-medium", c.estimatedROI >= 30 ? "text-primary" : c.estimatedROI >= 15 ? "text-foreground" : "text-warning")}>
                  {c.estimatedROI.toFixed(0)}%
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Desktop: tabla completa */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground bg-secondary/30">
              <SortableHeader label="Categoría" active={sortKey === "category"} dir={sortDir} onClick={() => toggleSort("category")} align="left" />
              <SortableHeader label="% Ventas" active={sortKey === "salesParticipationPct"} dir={sortDir} onClick={() => toggleSort("salesParticipationPct")} />
              <SortableHeader label="Fondo asignado" active={sortKey === "reinvestmentShare"} dir={sortDir} onClick={() => toggleSort("reinvestmentShare")} />
              <SortableHeader label="Cobertura actual" active={sortKey === "currentCoverageDays"} dir={sortDir} onClick={() => toggleSort("currentCoverageDays")} />
              <th className="px-4 py-2.5 text-center font-medium">Señal</th>
              <SortableHeader label="Unidades a comprar" active={sortKey === "unitsToBuy"} dir={sortDir} onClick={() => toggleSort("unitsToBuy")} />
              <SortableHeader label="Inversión OTB" active={sortKey === "estimatedInvestment"} dir={sortDir} onClick={() => toggleSort("estimatedInvestment")} />
              <SortableHeader label="Ajustada" active={sortKey === "adjustedInvestment"} dir={sortDir} onClick={() => toggleSort("adjustedInvestment")} />
              <SortableHeader label="ROI" active={sortKey === "estimatedROI"} dir={sortDir} onClick={() => toggleSort("estimatedROI")} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const coverageColor =
                c.coverageBrake === "urgente" ? "text-destructive font-semibold"
                : c.coverageBrake === "freno" ? "text-warning"
                : "text-foreground";
              const roiColor = c.estimatedROI >= 30 ? "text-primary" : c.estimatedROI >= 15 ? "text-foreground" : "text-warning";
              const barWidth = Math.min(c.salesParticipationPct, 100);

              return (
                <tr key={c.category} className="border-b border-border last:border-0 hover:bg-secondary/20 group">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={categoryHref(c.rawCategory)}
                      className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                    >
                      {c.category}
                      <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-primary/60 rounded-full" style={{ width: `${barWidth}%` }} />
                      </div>
                      <span className="font-medium w-10 text-right">{c.salesParticipationPct.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-primary">
                    {formatCurrency(c.reinvestmentShare)}
                  </td>
                  <td className={cn("px-4 py-3 text-right", coverageColor)}>
                    {c.currentCoverageDays.toFixed(0)}d
                  </td>
                  <td className="px-4 py-3 text-center">
                    <BrakeBadge brake={c.coverageBrake} />
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {Math.round(c.unitsToBuy).toLocaleString("es-CO")}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {formatCurrency(c.estimatedInvestment)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {c.coverageBrake === "freno"
                      ? <span className="text-warning">{formatCurrency(c.adjustedInvestment)} <span className="text-xs opacity-70">(−50%)</span></span>
                      : formatCurrency(c.adjustedInvestment)}
                  </td>
                  <td className={cn("px-4 py-3 text-right font-semibold", roiColor)}>
                    {c.estimatedROI.toFixed(0)}%
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
