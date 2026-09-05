"use client";

import { formatCurrency, cn } from "@/lib/utils";
import { ImageOff, Package } from "lucide-react";
import type { CatalogRow } from "@/lib/products/types";

const TIPO_LABEL: Record<CatalogRow["type"], string> = {
  consu: "Bienes",
  service: "Servicio",
  combo: "Combo",
};

export function CatalogTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
}: {
  rows: CatalogRow[];
  // Solo se consulta con .has: un Map sirve igual que un Set y permite que
  // la seleccion recuerde datos de productos que no estan en esta pagina.
  selected: ReadonlyMap<number, unknown>;
  onToggle: (row: CatalogRow) => void;
  onToggleAll: () => void;
}) {
  const todosMarcados = rows.length > 0 && rows.every((r) => selected.has(r.templateId));

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <Package className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Ningún producto coincide con estos filtros.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            <th className="py-2 px-3 w-8">
              <input
                type="checkbox"
                checked={todosMarcados}
                onChange={onToggleAll}
                aria-label="Seleccionar toda la página"
                className="h-3.5 w-3.5 accent-primary"
              />
            </th>
            <th className="py-2 px-3 text-left font-medium">Producto</th>
            <th className="py-2 px-3 text-left font-medium">Categoría</th>
            <th className="py-2 px-3 text-left font-medium">Proveedor</th>
            <th className="py-2 px-3 text-right font-medium">Precio</th>
            <th className="py-2 px-3 text-right font-medium">Stock</th>
            <th className="py-2 px-3 text-center font-medium">Tipo</th>
            <th className="py-2 px-3 text-center font-medium">Web</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.templateId} className="border-b border-border last:border-0 hover:bg-secondary/40">
              <td className="py-2 px-3">
                <input
                  type="checkbox"
                  checked={selected.has(r.templateId)}
                  onChange={() => onToggle(r)}
                  aria-label={`Seleccionar ${r.name}`}
                  className="h-3.5 w-3.5 accent-primary"
                />
              </td>
              <td className="py-2 px-3">
                <div className="flex items-center gap-2">
                  {r.imageThumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageThumb} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                  ) : (
                    <span className="grid h-8 w-8 place-items-center rounded bg-secondary shrink-0">
                      <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium truncate max-w-[280px]">{r.name}</p>
                    {r.defaultCode ? <p className="text-muted-foreground">{r.defaultCode}</p> : null}
                  </div>
                </div>
              </td>
              <td className="py-2 px-3 text-muted-foreground">{r.categoryName ?? "—"}</td>
              <td className={cn("py-2 px-3", r.supplierName ? "text-muted-foreground" : "text-warning")}>
                {r.supplierName ?? "Sin proveedor"}
              </td>
              <td className="py-2 px-3 text-right font-medium">{formatCurrency(r.listPrice)}</td>
              <td className="py-2 px-3 text-right text-muted-foreground">
                {r.type === "service" ? "—" : r.qtyAvailable.toFixed(0)}
              </td>
              <td className="py-2 px-3 text-center text-muted-foreground">{TIPO_LABEL[r.type]}</td>
              <td className="py-2 px-3 text-center">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    r.isPublished ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
                  )}
                >
                  {r.isPublished ? "Publicado" : "Oculto"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
