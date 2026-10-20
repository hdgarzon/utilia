"use client";

import { useEffect, useRef } from "react";
import type { ImageRepairPreviewItem } from "@/app/(dashboard)/productos/image-actions";

/** Antes y despues de las primeras fichas, antes de escribir el lote. */
export function ImageRepairPreviewDialog({
  limit,
  items,
  odooBaseUrl,
  pending,
  onCancel,
  onConfirm,
}: {
  limit: number;
  items: ImageRepairPreviewItem[];
  odooBaseUrl: string | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={pending ? undefined : onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="imagenes-dialog-titulo"
      tabIndex={-1}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 id="imagenes-dialog-titulo" className="text-base font-semibold">
            Vista previa de fotos reparadas
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Se recorta el margen blanco y se centra el producto en un cuadrado blanco, sin agrandarlo. Al confirmar se
            reparan hasta {limit} ficha{limit === 1 ? "" : "s"} en Odoo, empezando por las de clase A y B; la foto
            original de cada una queda respaldada. Estas son las primeras {items.length}.
          </p>
        </div>

        <ul className="space-y-3">
          {items.map((f) => (
            <li key={f.templateId} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">
                  {f.tier && <span className="mr-1 text-[11px] text-muted-foreground">[{f.tier}]</span>}
                  {f.name}
                </p>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                  {f.originalSize} → {f.side}x{f.side}
                  {odooBaseUrl && (
                    <>
                      {" · "}
                      <a
                        href={`${odooBaseUrl}/shop/${f.templateId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        ver ficha
                      </a>
                    </>
                  )}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {/* Miniaturas generadas en el servidor como data URL: next/image no aplica. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.antes} alt={`${f.name}, foto actual`} className="w-full rounded border border-border" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.despues} alt={`${f.name}, foto reparada`} className="w-full rounded border border-border" />
              </div>
              {!f.suficiente && (
                <p className="text-[11px] text-amber-600">
                  Mejora el encuadre, pero la foto es pequeña: conviene tomar una nueva.
                </p>
              )}
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || items.length === 0}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {pending ? "Reparando fotos…" : `Reparar hasta ${limit} fotos en Odoo`}
          </button>
        </div>
      </div>
    </div>
  );
}
