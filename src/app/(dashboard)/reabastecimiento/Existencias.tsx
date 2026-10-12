import { prisma } from "@/lib/prisma";
import { isServiceCategory } from "@/lib/service-categories";
import { InventoryTable, type InventoryRow } from "@/components/dashboard/InventoryTable";
import { HelpCircle } from "lucide-react";

// Antes era el tab Inventario. Se fusiono aqui porque respondia la misma
// pregunta ("¿que se esta acabando?"); la lista sin rotacion ya vive completa
// en Liquidacion. Umbrales iguales al resumen: "critico" = menos de una semana.
const CRITICAL_STOCK_DAYS = 7;
const LOW_STOCK_DAYS = 14;

function stockHealth(daysOfStock: number): InventoryRow["status"] {
  if (daysOfStock < CRITICAL_STOCK_DAYS) return "critical";
  if (daysOfStock < LOW_STOCK_DAYS) return "warning";
  return "ok";
}

async function getStockRows() {
  // `daysOfStock` solo tiene sentido para productos que venden: para los que no
  // venden el sync deja 0 (sentinel) y caerian todos en "critico".
  const rows = await prisma.productInsight.findMany({
    where: { avgDailySales7d: { gt: 0 } },
    orderBy: { daysOfStock: "asc" },
  });
  // Servicios (fotocopias, impresiones) tienen stock 0 estructural.
  const stockable = rows.filter((p) => !isServiceCategory(p.category));
  // Stock negativo = error de inventario en Odoo, no una senal de reposicion.
  return {
    clean: stockable.filter((p) => p.stockQty >= 0),
    dataIssues: stockable.filter((p) => p.stockQty < 0),
  };
}

export async function Existencias() {
  const { clean, dataIssues } = await getStockRows().catch(() => ({
    clean: [] as Awaited<ReturnType<typeof getStockRows>>["clean"],
    dataIssues: [] as Awaited<ReturnType<typeof getStockRows>>["dataIssues"],
  }));

  return (
    <section id="existencias" className="scroll-mt-20 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Existencias</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Todo lo que vendió en los últimos 7 días, con los días de stock que le quedan a ese ritmo.
        </p>
      </div>

      {dataIssues.length > 0 && (
        <div className="rounded-xl bg-secondary/60 p-4 flex items-start gap-3">
          <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">
              {dataIssues.length} producto{dataIssues.length !== 1 ? "s" : ""} con stock negativo
            </span>{" "}
            (vende pero Odoo reporta existencias &lt; 0). Es un error de inventario a corregir en Odoo, no una alerta de
            reposición:{" "}
            {dataIssues.slice(0, 5).map((p) => p.name).join(", ")}
            {dataIssues.length > 5 ? "…" : ""}
          </div>
        </div>
      )}

      <InventoryTable
        rows={clean.map((p): InventoryRow => ({
          id: p.id,
          name: p.name,
          category: p.category,
          stockQty: p.stockQty,
          daysOfStock: p.daysOfStock,
          minStock: p.minStock,
          maxStock: p.maxStock,
          salePrice: p.salePrice,
          status: stockHealth(p.daysOfStock),
        }))}
      />
    </section>
  );
}
