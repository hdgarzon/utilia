"use client";

import { useMemo } from "react";
import { formatCurrency, cn } from "@/lib/utils";
import { buildCsv, downloadCsv } from "@/lib/csv";
import type { MonthlyPurchaseSummary } from "@/lib/analytics/purchases";
import { Truck, TrendingUp, TrendingDown, Download } from "lucide-react";

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

interface Props {
  summary: MonthlyPurchaseSummary;
  reinvestmentFund: number;
}

export function PurchasesActuals({ summary, reinvestmentFund }: Props) {
  const { ordersCount, unitsReceived, distinctProducts, totalSpent, deltaPct, topProducts, recentOrders } = summary;
  const monthLabel = MONTH_NAMES[summary.month - 1];

  const fundUsedPct = reinvestmentFund > 0 ? Math.min((totalSpent / reinvestmentFund) * 100, 999) : null;

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short" }),
    []
  );

  function handleExport() {
    const csv = buildCsv(recentOrders, [
      { header: "Orden", value: (o) => o.name },
      { header: "Proveedor", value: (o) => o.partnerName ?? "" },
      { header: "Fecha", value: (o) => o.dateOrder.toISOString().slice(0, 10) },
      { header: "Total", value: (o) => Math.round(o.amountTotal) },
    ]);
    downloadCsv(`compras-${summary.year}-${String(summary.month).padStart(2, "0")}.csv`, csv);
  }

  if (ordersCount === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-center">
        <Truck className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Sin entradas de mercancía registradas en {monthLabel}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 md:px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
        <Truck className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Compras reales — {monthLabel}</h3>
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary transition-colors"
          title="Exportar órdenes de compra del mes a CSV"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </button>
      </div>

      <div className="p-4 md:p-5 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Gastado</p>
            <p className="text-xl font-bold">{formatCurrency(totalSpent)}</p>
            {deltaPct !== null && (
              <p className={cn("text-xs font-medium flex items-center gap-1", deltaPct >= 0 ? "text-warning" : "text-primary")}>
                {deltaPct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(deltaPct).toFixed(0)}% vs mes anterior
              </p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Entradas</p>
            <p className="text-xl font-bold">{ordersCount}</p>
            <p className="text-xs text-muted-foreground">órdenes recibidas</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Unidades</p>
            <p className="text-xl font-bold">{Math.round(unitsReceived).toLocaleString("es-CO")}</p>
            <p className="text-xs text-muted-foreground">recibidas</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Productos</p>
            <p className="text-xl font-bold">{distinctProducts}</p>
            <p className="text-xs text-muted-foreground">distintos</p>
          </div>
        </div>

        {/* Barra: gasto real vs fondo de reposición */}
        {fundUsedPct !== null && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Consumo del Fondo de Reposición</span>
              <span className="font-medium">{fundUsedPct.toFixed(0)}%</span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className={cn("h-full rounded-full", fundUsedPct > 100 ? "bg-destructive" : "bg-primary/70")}
                style={{ width: `${Math.min(fundUsedPct, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Últimas órdenes + top productos */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Últimas órdenes</p>
            <div className="space-y-1.5">
              {recentOrders.map((o) => (
                <div key={o.name} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground truncate">
                    {dateFmt.format(o.dateOrder)} · {o.partnerName ?? "Sin proveedor"}
                  </span>
                  <span className="font-medium shrink-0">{formatCurrency(o.amountTotal)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Top productos comprados</p>
            <div className="space-y-1.5">
              {topProducts.map((p) => (
                <div key={p.odooProductId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground truncate">{p.name}</span>
                  <span className="font-medium shrink-0">{formatCurrency(p.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
