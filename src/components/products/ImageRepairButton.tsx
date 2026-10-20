"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { toast } from "sonner";
import {
  previewImageRepair,
  writeImageRepairBatch,
  type ImageRepairPreviewItem,
  type ImageRepairUltimaCorrida,
} from "@/app/(dashboard)/productos/image-actions";
import { IMAGE_REPAIR_LIMIT, IMAGE_REPAIR_MAX } from "@/lib/products/image-repair-limits";
import { ImageRepairPreviewDialog } from "./ImageRepairPreviewDialog";

/**
 * "Reparar fotos": muestra el antes y despues de las primeras 5 fichas y, al
 * confirmar, reemplaza la foto del lote en Odoo (respaldando la original).
 * Dos pasos a proposito: la foto queda publica en el sitio.
 */
export function ImageRepairButton({
  ultimaCorrida,
  odooBaseUrl,
}: {
  ultimaCorrida: ImageRepairUltimaCorrida | null;
  odooBaseUrl: string | null;
}) {
  const [limit, setLimit] = useState(IMAGE_REPAIR_LIMIT);
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [preview, setPreview] = useState<ImageRepairPreviewItem[] | null>(null);
  const [ultima, setUltima] = useState(ultimaCorrida);

  async function abrir() {
    if (loading) return;
    setLoading(true);
    try {
      const r = await previewImageRepair();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.preview.length === 0) {
        toast.info("No hay fotos para reparar: las publicadas con stock ya estan cuadradas o no tienen fondo blanco.");
        return;
      }
      setPreview(r.preview);
    } catch (err) {
      console.error("[imagenes] la previsualizacion no llego al servidor:", err);
      toast.error("No se pudo contactar al servidor. Revisa la conexion e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmar() {
    if (!preview || writing) return;
    setWriting(true);
    try {
      const r = await writeImageRepairBatch({ limit });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setUltima({ at: new Date().toISOString(), written: r.written, failed: r.failed.length });
      if (r.failed.length === 0) {
        toast.success(`${r.written} foto${r.written === 1 ? "" : "s"} reparada${r.written === 1 ? "" : "s"} en Odoo`);
      } else {
        toast.warning(
          `${r.written} reparadas, ${r.failed.length} fallaron: ${r.failed
            .slice(0, 3)
            .map((f) => `${f.name}: ${f.error}`)
            .join(" · ")}${r.failed.length > 3 ? "…" : "."}`,
          { duration: 10_000 }
        );
      }
      setPreview(null);
    } catch (err) {
      console.error("[imagenes] la escritura no llego al servidor:", err);
      toast.error("No se pudo contactar al servidor. La corrida pudo haber quedado a medias; vuelve a abrir la vista previa.");
    } finally {
      setWriting(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Tope
          <input
            type="number"
            min={1}
            max={IMAGE_REPAIR_MAX}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(IMAGE_REPAIR_MAX, Number(e.target.value) || 1)))}
            className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-xs"
            aria-label="Tope de fotos por corrida"
          />
        </label>
        <button
          type="button"
          onClick={abrir}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-60"
        >
          <ImageIcon className="h-3.5 w-3.5" />
          {loading ? "Leyendo fotos…" : "Reparar fotos"}
        </button>
        {ultima && (
          <span className="text-[11px] text-muted-foreground" title={ultima.at}>
            Última corrida: {ultima.written} reparadas{ultima.failed > 0 ? `, ${ultima.failed} fallidas` : ""}
          </span>
        )}
      </div>

      {preview && (
        <ImageRepairPreviewDialog
          limit={limit}
          items={preview}
          odooBaseUrl={odooBaseUrl}
          pending={writing}
          onCancel={() => setPreview(null)}
          onConfirm={confirmar}
        />
      )}
    </>
  );
}
