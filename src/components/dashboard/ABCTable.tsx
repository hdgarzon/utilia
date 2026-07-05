"use client";

import { useMemo, useState } from "react";
import { formatCurrency, cn } from "@/lib/utils";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { FilterChip, SortableHeader } from "./table-controls";
import type { ABCProduct, ABCTier } from "@/lib/analytics/abc";
import { Search, Download, BarChart3 } from "lucide-react";

type SortKey = "rank" | "name" | "category" | "avgDailySales7d" | "stockQty" | "marginPct" | "monthlyRevenueProxy" | "cumulativeRevenuePct";
type TierFilter = "all" | ABCTier;

const TIER_BADGE: Record<ABCTier, string> = {
  A: "bg-primary/10 text-primary",
  B: "bg-warning/10 text-warning",
  C: "bg-muted text-muted-foreground",
};

const DEFAULT_VISIBLE = 30;

interface Props {
  products: ABCProduct[];
  totalMonthlyRevenue: number;
  totalMonthlyProfit: number;
}

export function ABCTable({ products, totalMonthlyRevenue, totalMonthlyProfit }: Props) {
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = products;
    if (tierFilter !== "all") out = out.filter((p) => p.tier === tierFilter);
    if (q) out = out.filter((p) => p.name.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      if (sortKey === "name" || sortKey === "category") {
        return (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "") * dir;
      }
      return (a[sortKey] - b[sortKey]) * dir;
    });
  }, [products, query, tierFilter, sortKey, sortDir]);

  const capped = !showAll && query.trim() === "" ? filtered.slice(0, DEFAULT_VISIBLE) : filtered;

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "rank" ? "asc" : "desc");
    }
  }

  function handleExport() {
    const csv = buildCsv(capped, [
      { header: "#", value: (p) => p.rank },
      { header: "Tier", value: (p) => p.tier },
      { header: "Producto", value: (p) => p.name },
      { header: "Categoría", value: (p) => p.category ?? "" },
      { header: "Vel/día", value: (p) => p.avgDailySales7d.toFixed(2) },
      { header: "Stock", value: (p) => Math.round(p.stockQty) },
      { header: "Margen %", value: (p) => p.marginPct.toFixed(1) },
      { header: "Revenue mensual", value: (p) => p.monthlyRevenueProxy },
      { header: "Acumulado %", value: (p) => p.cumulativeRevenuePct.toFixed(1) },
    ]);
    downloadCsv(`abc-pareto-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const counts = useMemo(() => {
    const c = { A: 0, B: 0, C: 0 };
    for (const p of products) c[p.tier]++;
    return c;
  }, [products]);

  const cappedByDefault = !showAll && query.trim() === "" && filtered.length > DEFAULT_VISIBLE;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 md:px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Productos por Revenue Proyectado</h3>
        <span className="text-xs text-muted-foreground">
          {capped.length} de {filtered.length}
          {tierFilter === "all" && query.trim() === "" ? ` (${products.length} total)` : ""}
        </span>
        <span className="ml-auto text-xs text-muted-foreground hidden md:inline">
          Total mensual proyectado: {formatCurrency(totalMonthlyRevenue)} · utilidad {formatCurrency(totalMonthlyProfit)}
        </span>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary transition-colors"
          title="Exportar vista actual a CSV"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </button>
      </div>

      <div className="px-4 md:px-5 py-3 flex flex-wrap items-center gap-2 border-b border-border">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en todo el catálogo…"
            className="w-full rounded-lg border border-border bg-input pl-8 pr-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <FilterChip label="Todos" active={tierFilter === "all"} onClick={() => setTierFilter("all")} />
          <FilterChip label={`Tier A (${counts.A})`} active={tierFilter === "A"} onClick={() => setTierFilter("A")} tone="ok" />
          <FilterChip label={`Tier B (${counts.B})`} active={tierFilter === "B"} onClick={() => setTierFilter("B")} tone="warning" />
          <FilterChip label={`Tier C (${counts.C})`} active={tierFilter === "C"} onClick={() => setTierFilter("C")} />
        </div>
        {cappedByDefault && (
          <button
            onClick={() => setShowAll(true)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Mostrar los {filtered.length}
          </button>
        )}
      </div>

      <div className="overflow-auto max-h-[560px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-secondary/95 backdrop-blur">
            <tr className="border-b border-border text-muted-foreground">
              <SortableHeader label="#" active={sortKey === "rank"} dir={sortDir} onClick={() => toggleSort("rank")} />
              <th className="py-2 px-3 text-center font-medium">Tier</th>
              <SortableHeader label="Producto" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" />
              <SortableHeader label="Categoría" active={sortKey === "category"} dir={sortDir} onClick={() => toggleSort("category")} align="left" />
              <SortableHeader label="Vel/día" active={sortKey === "avgDailySales7d"} dir={sortDir} onClick={() => toggleSort("avgDailySales7d")} />
              <SortableHeader label="Stock" active={sortKey === "stockQty"} dir={sortDir} onClick={() => toggleSort("stockQty")} />
              <SortableHeader label="Margen" active={sortKey === "marginPct"} dir={sortDir} onClick={() => toggleSort("marginPct")} />
              <SortableHeader label="Rev mes" active={sortKey === "monthlyRevenueProxy"} dir={sortDir} onClick={() => toggleSort("monthlyRevenueProxy")} />
              <SortableHeader label="Acum %" active={sortKey === "cumulativeRevenuePct"} dir={sortDir} onClick={() => toggleSort("cumulativeRevenuePct")} />
            </tr>
          </thead>
          <tbody>
            {capped.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-6 text-center text-muted-foreground">
                  Sin resultados para este filtro.
                </td>
              </tr>
            ) : (
              capped.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                  <td className="px-3 py-2 text-muted-foreground">{p.rank}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={cn("inline-flex items-center justify-center w-6 h-6 rounded-full font-bold", TIER_BADGE[p.tier])}>
                      {p.tier}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium max-w-64 truncate">{p.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.category ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{p.avgDailySales7d.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{Math.round(p.stockQty)}</td>
                  <td className={cn("px-3 py-2 text-right font-medium", p.marginPct < 0 ? "text-destructive" : p.marginPct < 20 ? "text-warning" : "text-foreground")}>
                    {p.marginPct.toFixed(0)}%
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{formatCurrency(p.monthlyRevenueProxy)}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{p.cumulativeRevenuePct.toFixed(1)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
