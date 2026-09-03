"use client";

import { useMemo, useState } from "react";
import { formatCurrency, cn } from "@/lib/utils";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { FilterChip, SortableHeader } from "./table-controls";
import { Search, Download, Package } from "lucide-react";

export interface InventoryRow {
  id: string;
  name: string;
  category: string | null;
  stockQty: number;
  daysOfStock: number;
  salePrice: number;
  minStock: number;
  maxStock: number;
  status: "critical" | "warning" | "ok";
}

type SortKey = "name" | "stockQty" | "daysOfStock" | "salePrice" | "status";
type StatusFilter = "all" | "critical" | "warning" | "ok";

const STATUS_LABEL: Record<InventoryRow["status"], string> = {
  critical: "Crítico",
  warning: "Bajo",
  ok: "OK",
};
const STATUS_ORDER: Record<InventoryRow["status"], number> = { critical: 0, warning: 1, ok: 2 };
const STATUS_CLASS: Record<InventoryRow["status"], string> = {
  critical: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  ok: "bg-primary/10 text-primary",
};

interface Props {
  rows: InventoryRow[];
}

export function InventoryTable({ rows }: Props) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("daysOfStock");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (statusFilter !== "all") out = out.filter((r) => r.status === statusFilter);
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
      if (sortKey === "status") return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * dir;
      return (a[sortKey] - b[sortKey]) * dir;
    });
  }, [rows, query, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function handleExport() {
    const csv = buildCsv(filtered, [
      { header: "Producto", value: (r) => r.name },
      { header: "Categoría", value: (r) => r.category ?? "" },
      { header: "Stock", value: (r) => Math.round(r.stockQty) },
      { header: "Días de stock", value: (r) => r.daysOfStock.toFixed(1) },
      { header: "Precio", value: (r) => r.salePrice },
      { header: "Estado", value: (r) => STATUS_LABEL[r.status] },
    ]);
    downloadCsv(`inventario-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, ok: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Package className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Productos con Rotación</h3>
        <span className="text-xs text-muted-foreground">
          {filtered.length} de {rows.length}
        </span>
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary transition-colors"
          title="Exportar vista actual a CSV"
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
        <div className="flex items-center gap-1.5">
          <FilterChip label="Todos" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
          <FilterChip label={`Críticos (${counts.critical})`} active={statusFilter === "critical"} onClick={() => setStatusFilter("critical")} tone="critical" />
          <FilterChip label={`Bajos (${counts.warning})`} active={statusFilter === "warning"} onClick={() => setStatusFilter("warning")} tone="warning" />
          <FilterChip label={`OK (${counts.ok})`} active={statusFilter === "ok"} onClick={() => setStatusFilter("ok")} tone="ok" />
        </div>
      </div>

      <div className="overflow-auto max-h-[560px] rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-secondary/95 backdrop-blur">
            <tr className="border-b border-border text-muted-foreground">
              <SortableHeader label="Producto" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" />
              <SortableHeader label="Stock" active={sortKey === "stockQty"} dir={sortDir} onClick={() => toggleSort("stockQty")} />
              <SortableHeader label="Días Stock" active={sortKey === "daysOfStock"} dir={sortDir} onClick={() => toggleSort("daysOfStock")} />
              <th className="py-2 px-3 text-right font-medium" title="Punto de reorden: entrega + colchon por variabilidad">Mín.</th>
              <th className="py-2 px-3 text-right font-medium" title="Tope de reposicion: no conviene tener mas que esto">Máx.</th>
              <SortableHeader label="Precio" active={sortKey === "salePrice"} dir={sortDir} onClick={() => toggleSort("salePrice")} />
              <SortableHeader label="Estado" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted-foreground">
                  Sin resultados para este filtro.
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                  <td className="py-2 px-3 font-medium max-w-64 truncate">{p.name}</td>
                  <td className="py-2 px-3 text-right">{p.stockQty.toFixed(0)}</td>
                  <td
                    className={cn(
                      "py-2 px-3 text-right font-medium",
                      p.status === "critical" ? "text-destructive" : p.status === "warning" ? "text-warning" : "text-primary"
                    )}
                  >
                    {p.daysOfStock.toFixed(0)}d
                  </td>
                  <td
                    className={cn(
                      "py-2 px-3 text-right tabular-nums",
                      p.minStock > 0 && p.stockQty < p.minStock ? "font-semibold text-destructive" : "text-muted-foreground"
                    )}
                    title={p.minStock > 0 && p.stockQty < p.minStock ? "Por debajo del minimo: toca pedir" : undefined}
                  >
                    {p.minStock > 0 ? p.minStock : "—"}
                  </td>
                  <td
                    className={cn(
                      "py-2 px-3 text-right tabular-nums",
                      p.maxStock > 0 && p.stockQty > p.maxStock ? "font-semibold text-warning" : "text-muted-foreground"
                    )}
                    title={p.maxStock > 0 && p.stockQty > p.maxStock ? "Por encima del maximo: capital inmovilizado" : undefined}
                  >
                    {p.maxStock > 0 ? p.maxStock : "—"}
                  </td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{formatCurrency(p.salePrice)}</td>
                  <td className="py-2 px-3 text-right">
                    <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", STATUS_CLASS[p.status])}>
                      {STATUS_LABEL[p.status]}
                    </span>
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
