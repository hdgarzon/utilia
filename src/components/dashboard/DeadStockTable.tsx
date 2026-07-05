"use client";

import { useMemo, useState } from "react";
import { formatCurrency, cn } from "@/lib/utils";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { FilterChip, SortableHeader } from "./table-controls";
import type { DeadStockProduct } from "@/lib/analytics/dead-stock";
import { PackageX, Download, Search } from "lucide-react";

type SortKey = "name" | "category" | "stockQty" | "investedCapital" | "retailValue" | "rotationDays" | "suggestedPrice";

interface Props {
  products: DeadStockProduct[];
  discountPct: number;
}

export function DeadStockTable({ products, discountPct }: Props) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("investedCapital");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category ?? "Sin categoría"));
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = products;
    if (categoryFilter !== "all") {
      out = out.filter((p) => (p.category ?? "Sin categoría") === categoryFilter);
    }
    if (q) out = out.filter((p) => p.name.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      if (sortKey === "name" || sortKey === "category") {
        const av = sortKey === "category" ? (a.category ?? "Sin categoría") : a.name;
        const bv = sortKey === "category" ? (b.category ?? "Sin categoría") : b.name;
        return av.localeCompare(bv) * dir;
      }
      if (sortKey === "suggestedPrice") {
        return (a.salePrice * (1 - discountPct / 100) - b.salePrice * (1 - discountPct / 100)) * dir;
      }
      return (a[sortKey] - b[sortKey]) * dir;
    });
  }, [products, query, categoryFilter, sortKey, sortDir, discountPct]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function handleExport() {
    const csv = buildCsv(filtered, [
      { header: "Producto", value: (p) => p.name },
      { header: "Categoría", value: (p) => p.category ?? "Sin categoría" },
      { header: "Stock", value: (p) => Math.round(p.stockQty) },
      { header: "Días sin venta", value: (p) => p.rotationDays },
      { header: "Capital invertido", value: (p) => Math.round(p.investedCapital) },
      { header: "Valor retail", value: (p) => Math.round(p.retailValue) },
      { header: `Precio liquidación (${discountPct}% off)`, value: (p) => Math.round(p.salePrice * (1 - discountPct / 100)) },
    ]);
    downloadCsv(`capital-muerto-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <PackageX className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Productos sin rotación</h3>
        <span className="text-xs text-muted-foreground">{filtered.length} de {products.length}</span>
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary transition-colors"
          title="Exportar a CSV"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto…"
            className="w-full rounded-lg border border-border bg-input pl-8 pr-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip label="Todas" active={categoryFilter === "all"} onClick={() => setCategoryFilter("all")} />
          {categories.map((c) => (
            <FilterChip key={c} label={c} active={categoryFilter === c} onClick={() => setCategoryFilter(c)} />
          ))}
        </div>
      </div>

      <div className="overflow-auto max-h-[560px] rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-secondary/95 backdrop-blur">
            <tr className="border-b border-border text-muted-foreground">
              <SortableHeader label="Producto" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" />
              <SortableHeader label="Categoría" active={sortKey === "category"} dir={sortDir} onClick={() => toggleSort("category")} align="left" />
              <SortableHeader label="Stock" active={sortKey === "stockQty"} dir={sortDir} onClick={() => toggleSort("stockQty")} />
              <SortableHeader label="Días sin venta" active={sortKey === "rotationDays"} dir={sortDir} onClick={() => toggleSort("rotationDays")} />
              <SortableHeader label="Capital invertido" active={sortKey === "investedCapital"} dir={sortDir} onClick={() => toggleSort("investedCapital")} />
              <SortableHeader label="Valor retail" active={sortKey === "retailValue"} dir={sortDir} onClick={() => toggleSort("retailValue")} />
              <SortableHeader label={`Precio liquid. (${discountPct}%)`} active={sortKey === "suggestedPrice"} dir={sortDir} onClick={() => toggleSort("suggestedPrice")} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted-foreground">Sin resultados para este filtro.</td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                  <td className="py-2 px-3 font-medium max-w-64 truncate">{p.name}</td>
                  <td className="py-2 px-3 text-muted-foreground">{p.category ?? "Sin categoría"}</td>
                  <td className="py-2 px-3 text-right">{p.stockQty.toFixed(0)}</td>
                  <td className="py-2 px-3 text-right text-warning font-medium">{p.rotationDays}d</td>
                  <td className="py-2 px-3 text-right font-medium">{formatCurrency(p.investedCapital)}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{formatCurrency(p.retailValue)}</td>
                  <td className="py-2 px-3 text-right font-semibold text-primary">
                    {formatCurrency(p.salePrice * (1 - discountPct / 100))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
