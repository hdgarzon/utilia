"use client";

import { useRef, useState } from "react";
import { ImagePlus, Link2, X } from "lucide-react";
import { resizeImageToBase64 } from "@/lib/products/image-resize";
import { cn } from "@/lib/utils";
import type { CellError } from "@/lib/products/import-types";

export function ImageCell({
  imageUrl,
  imageData,
  error,
  ariaProps,
  onChange,
}: {
  imageUrl: string | null;
  imageData: string | null;
  /**
   * Problema de `validateRow` en la celda `imageUrl` (p. ej. un link que no
   * empieza por http). Antes esta celda no recibia esto: un CSV con un
   * nombre de archivo o una nota en la columna de imagen marcaba la fila con
   * error y bloqueaba "Crear en Odoo" sin pintar ninguna celda de rojo.
   */
  error?: CellError;
  /** Mismo `aria-invalid`/`aria-describedby` que arma `ImportSheetRow` para
   *  las demas celdas, para que el lector de pantalla anuncie el mismo
   *  mensaje que ya se muestra en el `<span>` oculto al final de la fila. */
  ariaProps?: { "aria-invalid"?: boolean; "aria-describedby"?: string };
  onChange: (cambio: { imageUrl: string | null; imageData: string | null }) => void;
}) {
  const inputArchivo = useRef<HTMLInputElement>(null);
  const [modo, setModo] = useState<"none" | "link">(imageUrl ? "link" : "none");
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  async function elegirArchivo(file: File | undefined) {
    if (!file) return;
    setErrorLocal(null);
    try {
      const base64 = await resizeImageToBase64(file);
      // El archivo gana sobre el link: son excluyentes.
      onChange({ imageData: base64, imageUrl: null });
      setModo("none");
    } catch (err) {
      setErrorLocal(err instanceof Error ? err.message : "No se pudo procesar la imagen");
    }
  }

  // El error de validacion (viene de afuera, contra el catalogo) y el error
  // local (fallo al procesar un archivo) son problemas distintos, pero se
  // muestran igual: texto rojo debajo de la celda.
  const mensajeError = error?.message ?? errorLocal;

  if (imageData) {
    return (
      <div className="flex items-center gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/jpeg;base64,${imageData}`} alt="" className="h-8 w-8 rounded object-cover" />
        <button
          onClick={() => onChange({ imageData: null, imageUrl: null })}
          aria-label="Quitar la imagen"
          className="text-muted-foreground hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {modo === "link" ? (
        <input
          value={imageUrl ?? ""}
          onChange={(e) => onChange({ imageUrl: e.target.value || null, imageData: null })}
          placeholder="https://…"
          aria-label="Link de la imagen"
          {...ariaProps}
          className={cn(
            "w-full rounded border bg-background px-1.5 py-1 text-xs",
            error ? "border-destructive" : "border-border"
          )}
        />
      ) : (
        <div className="flex gap-1">
          <button
            onClick={() => inputArchivo.current?.click()}
            aria-label="Subir una imagen desde el computador"
            className="rounded border border-border p-1 text-muted-foreground hover:bg-secondary"
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setModo("link")}
            aria-label="Pegar el link de una imagen"
            className="rounded border border-border p-1 text-muted-foreground hover:bg-secondary"
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <input
        ref={inputArchivo}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => elegirArchivo(e.target.files?.[0])}
      />
      {mensajeError ? <p className="text-[10px] text-destructive">{mensajeError}</p> : null}
    </div>
  );
}
