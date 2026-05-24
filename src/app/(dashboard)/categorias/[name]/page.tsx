export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCategoryDetail, type CategoryProductRow } from "@/lib/analytics/category-detail";
import { formatCurrency, cn } from "@/lib/utils";
import {
  ArrowLeft,
  Package,
  TrendingUp,
  AlertTriangle,
  XCircle,
  DollarSign,
  TrendingDown,
} from "lucide-react";

const SENTINEL_NULL = "_sin_categoria";

interface PageProps {
  params: Promise<{ name: string }>;
}

export default async function CategoryDetailPage({ params }: PageProps) {
  const { name } = await params;
  // URL viene como encoded ("PAPELER%C3%8DA"). El sentinel especial mapea a null.
  const rawCategory = name === SENTINEL_NULL ? null : decodeURIComponent(name);
  const detail = await getCategoryDetail(rawCategory).catch(() => null);
  if (!detail) notFound();

  const { category, totals, topByVelocity, topByValue, criticalStock, stale, noMargin } = detail;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/categorias"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Volver a Categorías
        </Link>
        <h1 className="text-xl font-bold mt-2">{category}</h1>
        <p className="text-xs text-muted-foreground">
          {totals.productCount} productos · {totals.activeProducts} con ventas activas
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor Inventario</p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(totals.inventoryValue)}</p>
          <p className="text-xs text-muted-foreground">Retail: {formatCurrency(totals.retailValue)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Margen Promedio</p>
          <p
            className={cn(
              "text-2xl font-bold",
              totals.avgMarginPct >= 30 ? "text-primary" : totals.avgMarginPct >= 15 ? "text-foreground" : "text-warning"
            )}
          >
            {totals.avgMarginPct.toFixed(1)}%
          </p>
          <p className="text-xs text-muted-foreground">ponderado por stock</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Velocidad Total</p>
          <p className="text-2xl font-bold">{totals.totalDailySales.toFixed(1)}</p>
          <p className="text-xs text-muted-foreground">unidades/día (7d avg)</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Alertas Activas</p>
          <p className={cn("text-2xl font-bold", criticalStock.length + stale.length > 0 ? "text-warning" : "text-foreground")}>
            {criticalStock.length + stale.length + noMargin.length}
          </p>
          <p className="text-xs text-muted-foreground">
            {criticalStock.length} crit · {stale.length} stale · {noMargin.length} margen
          </p>
        </div>
      </div>

      {/* Critical stock */}
      {criticalStock.length > 0 && (
        <SectionTable
          title="Stock Crítico — Reabastecer urgente"
          icon={<XCircle className="h-4 w-4 text-destructive" />}
          tone="destructive"
          rows={criticalStock}
          columns={["product", "stockQty", "daysOfStock", "avgDailySales7d", "salePrice"]}
        />
      )}

      {/* Top velocity */}
      {topByVelocity.length > 0 && (
        <SectionTable
          title="Top por Velocidad de Venta"
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          rows={topByVelocity}
          columns={["product", "avgDailySales7d", "stockQty", "daysOfStock", "salePrice"]}
        />
      )}

      {/* No margin */}
      {noMargin.length > 0 && (
        <SectionTable
          title="Margen Bajo — Revisar precio"
          icon={<TrendingDown className="h-4 w-4 text-warning" />}
          tone="warning"
          rows={noMargin}
          columns={["product", "marginPct", "cmp", "salePrice", "avgDailySales7d"]}
        />
      )}

      {/* Top by inventory value */}
      {topByValue.length > 0 && (
        <SectionTable
          title="Top por Valor de Inventario"
          icon={<DollarSign className="h-4 w-4 text-primary" />}
          rows={topByValue}
          columns={["product", "stockQty", "cmp", "inventoryValue", "rotationDays"]}
        />
      )}

      {/* Stale */}
      {stale.length > 0 && (
        <SectionTable
          title="Sin Rotación — Capital inmovilizado"
          icon={<AlertTriangle className="h-4 w-4 text-warning" />}
          tone="warning"
          rows={stale}
          columns={["product", "stockQty", "rotationDays", "inventoryValue", "salePrice"]}
        />
      )}

      {/* Empty hint */}
      {totals.activeProducts === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">Sin ventas activas en esta categoría</p>
          <p className="text-xs text-muted-foreground">El próximo sync puede traer movimiento.</p>
        </div>
      )}
    </div>
  );
}

type Col = "product" | "stockQty" | "salePrice" | "cmp" | "marginPct" | "avgDailySales7d" | "daysOfStock" | "rotationDays" | "inventoryValue";

const COL_LABELS: Record<Col, string> = {
  product: "Producto",
  stockQty: "Stock",
  salePrice: "Precio",
  cmp: "CMP",
  marginPct: "Margen",
  avgDailySales7d: "Ventas 7d",
  daysOfStock: "Días stock",
  rotationDays: "Sin rotar",
  inventoryValue: "Valor inv",
};

function SectionTable({
  title,
  icon,
  rows,
  columns,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  rows: CategoryProductRow[];
  columns: Col[];
  tone?: "destructive" | "warning";
}) {
  const headerBg = tone === "destructive" ? "bg-destructive/5" : tone === "warning" ? "bg-warning/5" : "bg-secondary/30";
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{rows.length} productos</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className={cn("border-b border-border text-muted-foreground", headerBg)}>
              {columns.map((c) => (
                <th key={c} className={cn("px-4 py-2 font-medium", c === "product" ? "text-left" : "text-right")}>
                  {COL_LABELS[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                {columns.map((c) => (
                  <td key={c} className={cn("px-4 py-2", c === "product" ? "text-left max-w-64 truncate font-medium" : "text-right")}>
                    {renderCell(r, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderCell(r: CategoryProductRow, col: Col): React.ReactNode {
  switch (col) {
    case "product":
      return r.name;
    case "stockQty":
      return Math.round(r.stockQty).toLocaleString("es-CO");
    case "salePrice":
      return formatCurrency(r.salePrice);
    case "cmp":
      return formatCurrency(r.cmp);
    case "marginPct": {
      const tone =
        r.marginPct < 0 ? "text-destructive" : r.marginPct < 15 ? "text-warning" : "text-foreground";
      return <span className={cn("font-semibold", tone)}>{r.marginPct.toFixed(1)}%</span>;
    }
    case "avgDailySales7d":
      return r.avgDailySales7d.toFixed(2) + "/día";
    case "daysOfStock": {
      const tone =
        r.daysOfStock < 3 ? "text-destructive" : r.daysOfStock < 7 ? "text-warning" : "text-foreground";
      return <span className={cn("font-semibold", tone)}>{r.daysOfStock.toFixed(0)}d</span>;
    }
    case "rotationDays":
      return <span className="font-semibold text-warning">{r.rotationDays}d</span>;
    case "inventoryValue":
      return formatCurrency(r.inventoryValue);
  }
}
