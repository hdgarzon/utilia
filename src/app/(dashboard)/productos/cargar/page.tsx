export const dynamic = "force-dynamic";
// La creacion corre por tandas desde el cliente, pero cada tanda es una
// server action de esta pagina: hereda este presupuesto.
export const maxDuration = 300;

import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { getCatalogOptions } from "@/lib/products/catalog";
import { ImportSheet } from "@/components/products/ImportSheet";

export default async function CargarPage() {
  let options: Awaited<ReturnType<typeof getCatalogOptions>> | null = null;
  try {
    options = await getCatalogOptions();
  } catch (err) {
    console.error("[cargar] fallo la lectura de catalogos:", err);
  }

  if (!options) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Cargar productos</h1>
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              No se pudieron leer las categorías e impuestos de Odoo. Sin ellos la hoja no puede validar.
            </p>
            <Link href="/productos/cargar" className="text-xs font-medium text-primary hover:underline">
              Reintentar
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Cargar productos</h1>
        <Link
          href="/productos"
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver al catálogo
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground leading-relaxed">
        La <span className="font-semibold text-foreground">cantidad a la mano</span> se guarda aquí pero{" "}
        <span className="font-semibold text-foreground">no se escribe en Odoo</span>: ponerle cantidad a un
        producto exige un ajuste de inventario, y Utilia no los hace. Al terminar la carga te damos la lista de
        cantidades pendientes para que las cargues en Odoo.
      </div>

      <ImportSheet options={options} />
    </div>
  );
}
