"use client";

import { useRef, useState } from "react";
import { ImagePlus, Link2, X } from "lucide-react";
import { resizeImageToBase64 } from "@/lib/products/image-resize";

export function ImageCell({
  imageUrl,
  imageData,
  onChange,
}: {
  imageUrl: string | null;
  imageData: string | null;
  onChange: (cambio: { imageUrl: string | null; imageData: string | null }) => void;
}) {
  const inputArchivo = useRef<HTMLInputElement>(null);
  const [modo, setModo] = useState<"none" | "link">(imageUrl ? "link" : "none");
  const [error, setError] = useState<string | null>(null);

  async function elegirArchivo(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const base64 = await resizeImageToBase64(file);
      // El archivo gana sobre el link: son excluyentes.
      onChange({ imageData: base64, imageUrl: null });
      setModo("none");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo procesar la imagen");
    }
  }

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
          className="w-full rounded border border-border bg-background px-1.5 py-1 text-xs"
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
      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
    </div>
  );
}
