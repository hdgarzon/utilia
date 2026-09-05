"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type { CatalogOptions } from "@/lib/products/types";

export type BulkField = "categoria" | "categoriaWeb" | "publicar" | "impuesto" | "proveedor";

export const BULK_LABEL: Record<BulkField, string> = {
  categoria: "Categoría interna",
  categoriaWeb: "Categoría de ecommerce",
  publicar: "Publicación en web",
  impuesto: "Impuesto de compra",
  proveedor: "Proveedor",
};

export function BulkActionDialog({
  field,
  count,
  conProveedor,
  options,
  value,
  onValueChange,
  onCancel,
  onConfirm,
  pending,
}: {
  field: BulkField;
  count: number;
  /** Cuantos de los seleccionados ya tienen proveedor. Solo se usa en "proveedor". */
  conProveedor: number;
  options: CatalogOptions;
  value: string;
  onValueChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const lista =
    field === "categoria"
      ? options.categories
      : field === "categoriaWeb"
        ? options.publicCategories
        : field === "impuesto"
          ? options.purchaseTaxes
          : field === "proveedor"
            ? options.suppliers
            : [];

  const ref = useRef<HTMLDivElement>(null);

  // aria-modal="true" declara el fondo inerte, pero eso no mueve el foco por
  // si solo: sin esto, Escape no hace nada en el primer intento tras abrir
  // con el mouse (el foco sigue en el boton que abrio el dialogo) y Tab
  // puede sacar el foco hacia el fondo que se supone bloqueado.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      // Mientras la escritura esta en vuelo, ni el fondo ni Cancelar cierran:
      // cerrar NO cancela nada (la accion sigue corriendo en el servidor) y
      // dejaria al usuario creyendo que freno un cambio irreversible.
      onClick={pending ? undefined : onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-dialog-titulo"
      tabIndex={-1}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 id="bulk-dialog-titulo" className="text-sm font-semibold">{BULK_LABEL[field]}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Se aplicará a {count} producto{count !== 1 ? "s" : ""}.
          </p>
        </div>

        {field === "publicar" ? (
          <select
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            aria-label={BULK_LABEL[field]}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">Elegir…</option>
            <option value="1">Publicar en la tienda</option>
            <option value="0">Quitar de la tienda</option>
          </select>
        ) : (
          <select
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            aria-label={BULK_LABEL[field]}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">Elegir…</option>
            {lista.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}

        {field === "proveedor" && conProveedor > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">
                {conProveedor} de los {count} seleccionados ya tienen proveedor.
              </span>{" "}
              El proveedor nuevo los reemplaza: se pierden los precios y plazos que tengan cargados
              en Odoo. Esto no se puede deshacer.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={!value || pending}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Aplicando…" : "Aplicar"}
          </button>
        </div>
      </div>
    </div>
  );
}
