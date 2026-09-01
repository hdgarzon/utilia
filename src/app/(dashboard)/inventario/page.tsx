export const dynamic = 'force-dynamic';

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { isServiceCategory } from "@/lib/service-categories";
import { InventoryTable, type InventoryRow } from "@/components/dashboard/InventoryTable";
import { AlertTriangle, XCircle, CheckCircle, HelpCircle } from "lucide-react";

// Umbrales de salud de stock — unificados con el resumen (Home): "crítico" =
// menos de una semana de cobertura.
const CRITICAL_STOCK_DAYS = 7;
const LOW_STOCK_DAYS = 14;

// Clasifica por días de stock — coherente con las tarjetas KPI de arriba.
function stockHealth(daysOfStock: number): "critical" | "warning" | "ok" {
  if (daysOfStock < CRITICAL_STOCK_DAYS) return "critical";
  if (daysOfStock < LOW_STOCK_DAYS) return "warning";
  return "ok";
}

async function getInventoryData() {
  // `daysOfStock` solo tiene sentido para productos que venden. Para los que no
  // venden, el sync deja daysOfStock=0 (sentinel). Por eso filtramos por
  // avgDailySales7d>0 ANTES de clasificar: de lo contrario, todo el catálogo sin
  // ventas (la mayoría de SKUs) caería en "<7 días" e inflaría el conteo crítico.
  const rows = await prisma.productInsight.findMany({
    where: { avgDailySales7d: { gt: 0 } },
    orderBy: { daysOfStock: "asc" },
  });

  // Excluir servicios (fotocopias, impresiones…): tienen stock 0 estructural y
  // caerían siempre en "crítico" sin que haya nada que reponer → alarm fatigue.
  const stockable = rows.filter((p) => !isServiceCategory(p.category));

  // Stock negativo = error de inventario en Odoo, no una señal de reposición.
  // Se separa para no contaminar el conteo de críticos con datos por corregir.
  const dataIssues = stockable.filter((p) => p.stockQty < 0);
  const clean = stockable.filter((p) => p.stockQty >= 0);

  // daysOfStock<7 incluye 0 = vende pero sin stock (lo más urgente de todo).
  const critical = clean.filter((p) => p.daysOfStock < CRITICAL_STOCK_DAYS);
  const warning = clean.filter((p) => p.daysOfStock >= CRITICAL_STOCK_DAYS && p.daysOfStock < LOW_STOCK_DAYS);
  const healthy = clean.filter((p) => p.daysOfStock >= LOW_STOCK_DAYS);

  // Stock muerto: con existencias pero sin rotación hace +30 días.
  const stale = await prisma.productInsight.findMany({
    where: { rotationDays: { gt: 30 }, stockQty: { gt: 0 } },
    orderBy: { rotationDays: "desc" },
    take: 15,
  });

  return { all: clean, dataIssues, critical, warning, healthy, stale };
}

export default async function InventarioPage() {
  const { all, dataIssues, critical, warning, healthy, stale } = await getInventoryData().catch(() => ({ all: [] as Awaited<ReturnType<typeof getInventoryData>>["all"], dataIssues: [] as Awaited<ReturnType<typeof getInventoryData>>["dataIssues"], critical: [] as Awaited<ReturnType<typeof getInventoryData>>["critical"], warning: [] as Awaited<ReturnType<typeof getInventoryData>>["warning"], healthy: [] as Awaited<ReturnType<typeof getInventoryData>>["healthy"], stale: [] as Awaited<ReturnType<typeof getInventoryData>>["stale"] }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Inteligencia de Inventario</h1>
        <Link
          href="/reabastecimiento"
          className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
        >
          Generar pedido →
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-center">
          <XCircle className="h-5 w-5 text-destructive mx-auto mb-1" />
          <p className="text-2xl font-bold text-destructive">{critical.length}</p>
          <p className="text-xs text-muted-foreground">Críticos (&lt;7 días)</p>
        </div>
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-center">
          <AlertTriangle className="h-5 w-5 text-warning mx-auto mb-1" />
          <p className="text-2xl font-bold text-warning">{warning.length}</p>
          <p className="text-xs text-muted-foreground">Advertencia (7-14 días)</p>
        </div>
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 text-center">
          <CheckCircle className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-2xl font-bold text-primary">{healthy.length}</p>
          <p className="text-xs text-muted-foreground">OK (&gt;14 días)</p>
        </div>
      </div>

      {dataIssues.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
          <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">{dataIssues.length} producto{dataIssues.length !== 1 ? "s" : ""} con stock negativo</span>{" "}
            (vende pero Odoo reporta existencias &lt; 0). Es un error de inventario a corregir en Odoo, no una alerta de reposición — por eso no cuenta como crítico:{" "}
            {dataIssues.slice(0, 5).map((p) => p.name).join(", ")}{dataIssues.length > 5 ? "…" : ""}
          </div>
        </div>
      )}

      <InventoryTable
        rows={all.map((p): InventoryRow => ({
          id: p.id,
          name: p.name,
          category: p.category,
          stockQty: p.stockQty,
          daysOfStock: p.daysOfStock,
          salePrice: p.salePrice,
          status: stockHealth(p.daysOfStock),
        }))}
      />

      {stale.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
          <h3 className="text-sm font-semibold">Sin Rotación (&gt;30 días)</h3>
          <div className="space-y-2">
            {stale.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <p className="text-xs font-medium">{p.name}</p>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{p.rotationDays} días sin venta</p>
                  <p className="text-xs font-medium">{p.stockQty.toFixed(0)} en stock</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
