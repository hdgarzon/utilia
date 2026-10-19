"use client";

import { useMemo, useState } from "react";
import { formatCurrency, cn } from "@/lib/utils";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { FilterChip, SortableHeader } from "./table-controls";
import type { DeadStockProduct } from "@/lib/analytics/dead-stock";
import {
  suggestLiquidationPrice,
  tramoDef,
  TRAMOS_ANTIGUEDAD,
  type PrecioRemate,
  type TramoAntiguedad,
} from "@/lib/analytics/liquidation-pricing";
import { PackageX, Download, Search, Tag, AlertTriangle } from "lucide-react";

type SortKey =
  | "name"
  | "category"
  | "stockQty"
  | "investedCapital"
  | "retailValue"
  | "rotationDays"
  | "suggestedPrice"
  | "tramo"
  | "precioSugerido"
  | "margenPct";

type Row = DeadStockProduct & { remate: PrecioRemate };

interface Props {
  products: DeadStockProduct[];
  discountPct: number;
}

const TRAMO_ORDER: Record<TramoAntiguedad, number> = { "31-90": 0, "91-180": 1, "181-365": 2, "365+": 3 };

const TRAMO_TONE: Record<TramoAntiguedad, string> = {
  "31-90": "bg-secondary text-foreground",
  "91-180": "bg-warning/10 text-warning",
  "181-365": "bg-warning/20 text-warning",
  "365+": "bg-destructive/10 text-destructive",
};

const SIN_CATEGORIA = "Sin categoría";

export function DeadStockTable({ products, discountPct }: Props) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [tramoFilter, setTramoFilter] = useState<TramoAntiguedad | "all" | "alerta">("all");
  const [sortKey, setSortKey] = useState<SortKey>("investedCapital");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo<Row[]>(() => products.map((p) => ({ ...p, remate: suggestLiquidationPrice(p) })), [products]);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category ?? SIN_CATEGORIA));
    return Array.from(set).sort();
  }, [products]);

  const tramoCounts = useMemo(() => {
    const counts: Record<TramoAntiguedad, number> = { "31-90": 0, "91-180": 0, "181-365": 0, "365+": 0 };
    let alertas = 0;
    for (const r of rows) {
      counts[r.remate.tramo] += 1;
      if (r.remate.alerta) alertas += 1;
    }
    return { counts, alertas };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (categoryFilter !== "all") {
      out = out.filter((p) => (p.category ?? SIN_CATEGORIA) === categoryFilter);
    }
    if (tramoFilter === "alerta") out = out.filter((p) => p.remate.alerta);
    else if (tramoFilter !== "all") out = out.filter((p) => p.remate.tramo === tramoFilter);
    if (q) out = out.filter((p) => p.name.toLowerCase().includes(q) || (p.internalRef ?? "").toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      if (sortKey === "name" || sortKey === "category") {
        const av = sortKey === "category" ? (a.category ?? SIN_CATEGORIA) : a.name;
        const bv = sortKey === "category" ? (b.category ?? SIN_CATEGORIA) : b.name;
        return av.localeCompare(bv) * dir;
      }
      if (sortKey === "suggestedPrice") {
        return (a.salePrice * (1 - discountPct / 100) - b.salePrice * (1 - discountPct / 100)) * dir;
      }
      if (sortKey === "tramo") return (TRAMO_ORDER[a.remate.tramo] - TRAMO_ORDER[b.remate.tramo]) * dir;
      if (sortKey === "precioSugerido" || sortKey === "margenPct") {
        return (a.remate[sortKey] - b.remate[sortKey]) * dir;
      }
      return (a[sortKey] - b[sortKey]) * dir;
    });
  }, [rows, query, categoryFilter, tramoFilter, sortKey, sortDir, discountPct]);

  // Totales del lote filtrado. Las filas con alerta no tienen precio de remate
  // valido: cuentan en el capital pero no en la venta esperada.
  const totals = useMemo(() => {
    let capital = 0;
    let venta = 0;
    let alertas = 0;
    for (const r of filtered) {
      capital += r.investedCapital;
      if (r.remate.alerta) alertas += 1;
      else venta += r.stockQty * r.remate.precioSugerido;
    }
    const margen = venta - capital;
    const margenPct = venta > 0 ? (margen / venta) * 100 : 0;
    return { capital, venta, margen, margenPct, alertas };
  }, [filtered]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const today = () => new Date().toISOString().slice(0, 10);

  function handleExport() {
    const csv = buildCsv(filtered, [
      { header: "Producto", value: (p) => p.name },
      { header: "Categoría", value: (p) => p.category ?? SIN_CATEGORIA },
      { header: "Stock", value: (p) => Math.round(p.stockQty) },
      { header: "Días sin venta", value: (p) => p.rotationDays },
      { header: "Tramo", value: (p) => tramoDef(p.remate.tramo).etiqueta },
      { header: "Capital invertido", value: (p) => Math.round(p.investedCapital) },
      { header: "Valor retail", value: (p) => Math.round(p.retailValue) },
      { header: "Precio remate", value: (p) => Math.round(p.remate.precioSugerido) },
      { header: "Margen remate %", value: (p) => Math.round(p.remate.margenPct) },
      { header: `Precio liquidación (${discountPct}% off)`, value: (p) => Math.round(p.salePrice * (1 - discountPct / 100)) },
      { header: "Alerta", value: (p) => (p.remate.alerta ? "Revisar precio" : "") },
    ]);
    downloadCsv(`capital-muerto-${today()}.csv`, csv);
  }

  // Etiquetas: solo lo que tiene precio de remate valido. Lo que esta en
  // alerta se corrige primero en Odoo.
  function handleExportLabels() {
    const etiquetas = filtered.filter((p) => !p.remate.alerta);
    const csv = buildCsv(etiquetas, [
      { header: "Referencia interna", value: (p) => p.internalRef ?? "" },
      { header: "Nombre", value: (p) => p.name },
      { header: "Categoría", value: (p) => p.category ?? SIN_CATEGORIA },
      { header: "Precio normal", value: (p) => Math.round(p.salePrice) },
      { header: "Precio remate", value: (p) => Math.round(p.remate.precioSugerido) },
      { header: "Descuento %", value: (p) => Math.round(p.remate.descuentoPct) },
      { header: "Cantidad", value: (p) => Math.round(p.stockQty) },
    ]);
    downloadCsv(`etiquetas-remate-${today()}.csv`, csv);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <PackageX className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Productos sin rotación</h3>
        <span className="text-xs text-muted-foreground">{filtered.length} de {products.length}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={handleExportLabels}
            className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
            title="CSV con precio normal, precio de remate y descuento para imprimir etiquetas"
          >
            <Tag className="h-3.5 w-3.5" />
            Exportar etiquetas (CSV)
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary transition-colors"
            title="Exportar a CSV"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto o referencia…"
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

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground mr-1">Tramo:</span>
        <FilterChip label="Todos" active={tramoFilter === "all"} onClick={() => setTramoFilter("all")} />
        {TRAMOS_ANTIGUEDAD.map((t) => (
          <FilterChip
            key={t.clave}
            label={`${t.etiqueta} (${tramoCounts.counts[t.clave]})`}
            active={tramoFilter === t.clave}
            tone={t.clave === "365+" ? "critical" : t.clave === "31-90" ? undefined : "warning"}
            onClick={() => setTramoFilter(t.clave)}
          />
        ))}
        {tramoCounts.alertas > 0 && (
          <FilterChip
            label={`Revisar precio (${tramoCounts.alertas})`}
            active={tramoFilter === "alerta"}
            tone="critical"
            onClick={() => setTramoFilter("alerta")}
          />
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Total label="Capital del lote" value={formatCurrency(totals.capital)} />
        <Total label="Venta a precio sugerido" value={formatCurrency(totals.venta)} />
        <Total
          label="Margen resultante"
          value={`${formatCurrency(totals.margen)} (${totals.margenPct.toFixed(0)}%)`}
          tone={totals.margen < 0 ? "text-destructive" : "text-primary"}
        />
        <Total
          label="Por revisar precio"
          value={String(totals.alertas)}
          tone={totals.alertas > 0 ? "text-destructive" : undefined}
          hint={totals.alertas > 0 ? "Fuera de la venta esperada" : undefined}
        />
      </div>

      <div className="overflow-auto max-h-[560px] rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-secondary/95 backdrop-blur">
            <tr className="border-b border-border text-muted-foreground">
              <SortableHeader label="Producto" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" />
              <SortableHeader label="Categoría" active={sortKey === "category"} dir={sortDir} onClick={() => toggleSort("category")} align="left" />
              <SortableHeader label="Stock" active={sortKey === "stockQty"} dir={sortDir} onClick={() => toggleSort("stockQty")} />
              <SortableHeader label="Días sin venta" active={sortKey === "rotationDays"} dir={sortDir} onClick={() => toggleSort("rotationDays")} />
              <SortableHeader label="Tramo" active={sortKey === "tramo"} dir={sortDir} onClick={() => toggleSort("tramo")} align="left" />
              <SortableHeader label="Capital invertido" active={sortKey === "investedCapital"} dir={sortDir} onClick={() => toggleSort("investedCapital")} />
              <SortableHeader label="Precio normal" active={sortKey === "retailValue"} dir={sortDir} onClick={() => toggleSort("retailValue")} />
              <SortableHeader label="Precio sugerido" active={sortKey === "precioSugerido"} dir={sortDir} onClick={() => toggleSort("precioSugerido")} />
              <SortableHeader label="Margen" active={sortKey === "margenPct"} dir={sortDir} onClick={() => toggleSort("margenPct")} />
              <SortableHeader label={`Simulador (${discountPct}%)`} active={sortKey === "suggestedPrice"} dir={sortDir} onClick={() => toggleSort("suggestedPrice")} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-6 text-center text-muted-foreground">Sin resultados para este filtro.</td>
              </tr>
            ) : (
              filtered.map((p) => {
                const alerta = Boolean(p.remate.alerta);
                return (
                  <tr
                    key={p.id}
                    className={cn(
                      "border-b border-border last:border-0",
                      alerta ? "bg-destructive/10 hover:bg-destructive/15" : "hover:bg-secondary/20",
                    )}
                  >
                    <td className="py-2 px-3 font-medium max-w-64">
                      <div className="truncate" title={p.name}>{p.name}</div>
                      {p.internalRef && <div className="text-[10px] text-muted-foreground font-normal">{p.internalRef}</div>}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">{p.category ?? SIN_CATEGORIA}</td>
                    <td className="py-2 px-3 text-right">{p.stockQty.toFixed(0)}</td>
                    <td className="py-2 px-3 text-right text-warning font-medium">
                      {p.lastSoldAt === null ? <span title="Nunca vendido">{p.rotationDays}d*</span> : `${p.rotationDays}d`}
                    </td>
                    <td className="py-2 px-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap", TRAMO_TONE[p.remate.tramo])}>
                        {tramoDef(p.remate.tramo).etiqueta}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-medium">{formatCurrency(p.investedCapital)}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{formatCurrency(p.salePrice)}</td>
                    <td className="py-2 px-3 text-right font-semibold">
                      {alerta ? (
                        <span className="inline-flex items-center gap-1 text-destructive" title="Precio en 0 o por debajo del costo. Corrígelo en Odoo antes de rematar.">
                          <AlertTriangle className="h-3 w-3" />
                          Revisar precio
                        </span>
                      ) : (
                        <>
                          <span className="text-primary">{formatCurrency(p.remate.precioSugerido)}</span>
                          {p.remate.descuentoPct > 0 && (
                            <span className="ml-1 text-[10px] text-muted-foreground font-normal">-{p.remate.descuentoPct.toFixed(0)}%</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className={cn("py-2 px-3 text-right", p.remate.margenPct < 0 ? "text-destructive" : "text-muted-foreground")}>
                      {alerta ? "—" : `${p.remate.margenPct.toFixed(0)}%`}
                    </td>
                    <td className="py-2 px-3 text-right text-muted-foreground">
                      {formatCurrency(p.salePrice * (1 - discountPct / 100))}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        * Nunca vendido: va al tramo de costo + 10% aunque lleve pocos días en el sistema. Los precios de remate se redondean a la centena hacia arriba y nunca bajan del costo.
      </p>
    </div>
  );
}

function Total({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold", tone)}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
