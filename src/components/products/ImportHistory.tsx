"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle, XCircle, Clock, AlertTriangle, Pencil, Eye } from "lucide-react";
import { listBatches } from "@/app/(dashboard)/productos/cargar/actions";
import { colombiaDateTimeString } from "@/lib/timezone";
import type { BatchSummary } from "@/lib/products/import-types";

/**
 * Historial de lotes de carga.
 *
 * Se pidio porque no habia puerta de entrada a un lote ya guardado: se cerraba
 * la pantalla y el borrador quedaba en la base sin forma de volver a el.
 *
 * Lo que ofrece cada lote depende de sus filas, no de una etiqueta:
 *
 *  - Ninguna fila creada ni en curso -> "Editar". Se abre en la hoja y se
 *    sigue trabajando.
 *  - Alguna fila ya en Odoo -> "Ver". Se abre el resumen, con el reintento de
 *    las que fallaron y el CSV de cantidades pendientes.
 *
 * La diferencia no es cosmetica: reabrir en la hoja un lote con productos ya
 * creados y darle a "Crear en Odoo" es el camino directo a duplicarlos.
 * `saveBatch` lo rechazaria, pero mejor no ofrecer la puerta.
 */
export function ImportHistory({
  onAbrir,
  recargar,
}: {
  onAbrir: (batch: BatchSummary) => void;
  /** Cambia cuando termina una carga, para refrescar la lista. */
  recargar: number;
}) {
  const [lotes, setLotes] = useState<BatchSummary[] | null>(null);

  useEffect(() => {
    let vivo = true;
    listBatches()
      .then((r) => {
        if (!vivo) return;
        if (!r.ok) {
          toast.error(r.error ?? "No se pudo leer el historial");
          setLotes([]);
          return;
        }
        setLotes(r.batches ?? []);
      })
      .catch((err) => {
        console.error("[cargar] el historial no llego al servidor:", err);
        if (vivo) setLotes([]);
      });
    // Cancela el efecto de una carga anterior: sin esto, dos respuestas en
    // vuelo pueden llegar desordenadas y pintar la lista vieja encima.
    return () => {
      vivo = false;
    };
  }, [recargar]);

  if (lotes === null) {
    return <p className="text-xs text-muted-foreground px-1">Cargando el historial…</p>;
  }
  if (lotes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground px-1">
        Todavía no hay lotes. El primero que guardes aparece aquí.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card divide-y divide-border">
      {lotes.map((l) => (
        <div key={l.id} className="flex items-center gap-3 p-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">{l.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {colombiaDateTimeString(new Date(l.createdAt))} · {l.total} fila
              {l.total !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="flex items-center gap-2 text-[11px] whitespace-nowrap">
            {l.ok > 0 ? (
              <span className="inline-flex items-center gap-1 text-primary">
                <CheckCircle className="h-3 w-3" /> {l.ok}
              </span>
            ) : null}
            {l.error > 0 ? (
              <span className="inline-flex items-center gap-1 text-destructive">
                <XCircle className="h-3 w-3" /> {l.error}
              </span>
            ) : null}
            {l.pendientes > 0 ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" /> {l.pendientes}
              </span>
            ) : null}
            {l.sinConfirmar > 0 ? (
              <span className="inline-flex items-center gap-1 text-destructive font-semibold">
                <AlertTriangle className="h-3 w-3" /> {l.sinConfirmar} sin confirmar
              </span>
            ) : null}
          </div>

          <button
            onClick={() => onAbrir(l)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-secondary"
          >
            {l.editable ? (
              <>
                <Pencil className="h-3 w-3" /> Editar
              </>
            ) : (
              <>
                <Eye className="h-3 w-3" /> Ver
              </>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
