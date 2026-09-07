"use client";

import { CheckCircle, XCircle, AlertTriangle, Download, Clock } from "lucide-react";
import { buildCsv, downloadCsv } from "@/lib/csv";
import type { ImportRowDraft } from "@/lib/products/import-types";

export function ImportResult({
  rows,
  onRetry,
  onClose,
  retrying,
}: {
  rows: ImportRowDraft[];
  onRetry: () => void;
  onClose: () => void;
  retrying: boolean;
}) {
  const ok = rows.filter((r) => r.status === "OK");
  const fallidas = rows.filter((r) => r.status === "ERROR");
  // Una tanda puede fallar o cortarse antes de tocar todas las filas (tope de
  // vueltas agotado, una fila que se congelo por un doble fallo de registro).
  // Sin este tercer conteo, OK + fallidas no sumaba el total de filas y no
  // habia forma de saber, desde aqui, que parte del lote nunca se intento.
  const sinIntentar = rows.filter((r) => r.status === "PENDING");
  // Se llamo a Odoo y no se pudo confirmar el resultado aqui. El producto
  // PUEDE existir alla. Nada las reintenta solas -- a proposito -- asi que
  // esta pantalla es el unico lugar donde el dueño se entera.
  const sinConfirmar = rows.filter((r) => r.status === "CREATING");
  const avisos = ok.filter((r) => r.warning);
  const pendientesCantidad = ok.filter((r) => r.qtyOnHand !== null && r.qtyOnHand > 0);

  function descargarPendientes() {
    const csv = buildCsv(pendientesCantidad, [
      { header: "ID Odoo", value: (r) => r.odooTemplateId ?? "" },
      { header: "Producto", value: (r) => r.name },
      { header: "Cantidad a cargar", value: (r) => r.qtyOnHand ?? 0 },
    ]);
    downloadCsv("cantidades-pendientes.csv", csv);
  }

  return (
    <div className="space-y-4">
      {sinConfirmar.length > 0 ? (
        <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-4 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-semibold text-destructive">
                {sinConfirmar.length} fila{sinConfirmar.length !== 1 ? "s" : ""} sin confirmar — revísala
                {sinConfirmar.length !== 1 ? "s" : ""} en Odoo
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Se pidió crear{sinConfirmar.length !== 1 ? "los" : "lo"} en Odoo pero la respuesta no se pudo
                registrar aquí. Puede que exista{sinConfirmar.length !== 1 ? "n" : ""} allá y puede que no. Búscal
                {sinConfirmar.length !== 1 ? "os" : "o"} por nombre antes de volver a cargar
                {sinConfirmar.length !== 1 ? "los" : "lo"}:{" "}
                <span className="font-medium text-foreground">Reintentar no l{sinConfirmar.length !== 1 ? "as" : "a"} toca</span>,
                justamente para no duplicar el producto.
              </p>
            </div>
          </div>
          {sinConfirmar.slice(0, 20).map((r) => (
            <p key={r.id} className="text-xs text-muted-foreground pl-6">
              <span className="text-foreground">{r.name || `Fila ${r.rowIndex + 1}`}</span>
              {r.odooTemplateId ? ` — producto ${r.odooTemplateId} en Odoo` : ""}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 text-center">
          <CheckCircle className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-2xl font-bold text-primary">{ok.length}</p>
          <p className="text-xs text-muted-foreground">creados en Odoo</p>
        </div>
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-center">
          <XCircle className="h-5 w-5 text-destructive mx-auto mb-1" />
          <p className="text-2xl font-bold text-destructive">{fallidas.length}</p>
          <p className="text-xs text-muted-foreground">fallaron</p>
        </div>
        <div className="rounded-xl border border-border bg-secondary/40 p-4 text-center">
          <Clock className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-2xl font-bold text-foreground">{sinIntentar.length}</p>
          <p className="text-xs text-muted-foreground">sin intentar todavía</p>
        </div>
      </div>

      {pendientesCantidad.length > 0 ? (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">
                {pendientesCantidad.length} producto{pendientesCantidad.length !== 1 ? "s" : ""} nacieron en cero.
              </span>{" "}
              Utilia no mueve inventario, así que las cantidades que anotaste quedan pendientes de cargar en Odoo.
            </p>
          </div>
          <button
            onClick={descargarPendientes}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-secondary"
          >
            <Download className="h-3.5 w-3.5" /> Descargar cantidades pendientes
          </button>
        </div>
      ) : null}

      {avisos.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs font-semibold">Creados con advertencia</p>
          {avisos.slice(0, 10).map((r) => (
            <p key={r.id} className="text-xs text-muted-foreground">
              {r.name}: {r.warning}
            </p>
          ))}
        </div>
      ) : null}

      {fallidas.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-semibold">Filas que fallaron</p>
          {fallidas.slice(0, 20).map((r) => (
            <p key={r.id} className="text-xs text-muted-foreground">
              <span className="text-foreground">{r.name || `Fila ${r.rowIndex + 1}`}</span>: {r.error}
            </p>
          ))}
          <button
            onClick={onRetry}
            disabled={retrying}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {retrying ? "Reintentando…" : `Reintentar ${fallidas.length}`}
          </button>
        </div>
      ) : null}

      <button
        onClick={onClose}
        className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"
      >
        Cerrar y empezar otro lote
      </button>
    </div>
  );
}
