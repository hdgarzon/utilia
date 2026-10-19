"use client";

import { useEffect, useRef } from "react";
import type { SeoGenerated } from "@/lib/ai/seo-producto";

/**
 * Muestra las primeras fichas generadas antes de escribir el lote. El HTML
 * de la descripcion viene saneado por `sanitizeDescriptionHtml` (solo
 * parrafos, listas y negritas, sin atributos), por eso se puede renderizar.
 */
export function SeoPreviewDialog({
  total,
  items,
  previewFailed,
  odooBaseUrl,
  pending,
  onCancel,
  onConfirm,
}: {
  total: number;
  items: SeoGenerated[];
  previewFailed: number;
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
      aria-labelledby="seo-dialog-titulo"
      tabIndex={-1}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 id="seo-dialog-titulo" className="text-base font-semibold">
            Vista previa de textos SEO
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Se van a escribir {total} ficha{total === 1 ? "" : "s"} en Odoo (descripción web, meta title y meta
            descripción). Estas son las primeras {items.length}; el resto se genera al confirmar.
            {previewFailed > 0 && ` ${previewFailed} de la muestra no se pudieron generar y se reintentarán.`}
          </p>
        </div>

        <ul className="space-y-3">
          {items.map((f) => (
            <li key={f.templateId} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{f.metaTitle}</p>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                  {f.metaTitle.length}/60
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
              <p className="text-xs text-muted-foreground">
                {f.metaDescription}{" "}
                <span className="text-[11px]">({f.metaDescription.length}/155)</span>
              </p>
              <div
                className="text-xs leading-relaxed [&_p]:mb-1 [&_ul]:list-disc [&_ul]:pl-4"
                dangerouslySetInnerHTML={{ __html: f.websiteDescription }}
              />
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
            {pending ? `Escribiendo ${total} fichas…` : `Escribir ${total} fichas en Odoo`}
          </button>
        </div>
      </div>
    </div>
  );
}
