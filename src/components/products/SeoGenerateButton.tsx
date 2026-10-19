"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { previewSeo, writeSeoBatch, type SeoUltimaCorrida } from "@/app/(dashboard)/productos/seo-actions";
import type { SeoGenerated } from "@/lib/ai/seo-producto";
import { SeoPreviewDialog } from "./SeoPreviewDialog";

const LIMIT_DEFAULT = 50;

/**
 * "Generar SEO (A/B)": previsualiza las primeras 5 fichas y, al confirmar,
 * escribe el lote completo en Odoo. Dos pasos a proposito: lo que se escribe
 * queda publico en el sitio.
 */
export function SeoGenerateButton({
  ultimaCorrida,
  odooBaseUrl,
}: {
  ultimaCorrida: SeoUltimaCorrida | null;
  odooBaseUrl: string | null;
}) {
  const [limit, setLimit] = useState(LIMIT_DEFAULT);
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [preview, setPreview] = useState<{ total: number; items: SeoGenerated[]; previewFailed: number } | null>(null);
  const [ultima, setUltima] = useState(ultimaCorrida);

  async function abrir() {
    if (loading) return;
    setLoading(true);
    try {
      const r = await previewSeo({ limit });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.total === 0) {
        toast.info("No hay fichas pendientes: todas las publicadas con stock ya tienen descripcion.");
        return;
      }
      setPreview({ total: r.total, items: r.preview, previewFailed: r.previewFailed });
    } catch (err) {
      console.error("[seo] la previsualizacion no llego al servidor:", err);
      toast.error("No se pudo contactar al servidor. Revisa la conexion e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmar() {
    if (!preview || writing) return;
    setWriting(true);
    try {
      const r = await writeSeoBatch({ limit, previewed: preview.items });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setUltima({ at: new Date().toISOString(), written: r.written, failed: r.failed.length });
      if (r.failed.length === 0) {
        toast.success(`${r.written} ficha${r.written === 1 ? "" : "s"} con textos SEO escrita${r.written === 1 ? "" : "s"} en Odoo`);
      } else {
        toast.warning(
          `${r.written} escritas, ${r.failed.length} fallaron: ${r.failed
            .slice(0, 3)
            .map((f) => `${f.name}: ${f.error}`)
            .join(" · ")}${r.failed.length > 3 ? "…" : "."}`,
          { duration: 10_000 }
        );
      }
      setPreview(null);
    } catch (err) {
      console.error("[seo] la escritura no llego al servidor:", err);
      toast.error("No se pudo contactar al servidor. La corrida pudo haber quedado a medias; vuelve a abrir la previsualizacion.");
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
            max={200}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
            className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-xs"
            aria-label="Tope de fichas por corrida"
          />
        </label>
        <button
          type="button"
          onClick={abrir}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-60"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {loading ? "Generando vista previa…" : "Generar SEO (A/B)"}
        </button>
        {ultima && (
          <span className="text-[11px] text-muted-foreground" title={ultima.at}>
            Última corrida: {ultima.written} escritas{ultima.failed > 0 ? `, ${ultima.failed} fallidas` : ""}
          </span>
        )}
      </div>

      {preview && (
        <SeoPreviewDialog
          total={preview.total}
          items={preview.items}
          previewFailed={preview.previewFailed}
          odooBaseUrl={odooBaseUrl}
          pending={writing}
          onCancel={() => setPreview(null)}
          onConfirm={confirmar}
        />
      )}
    </>
  );
}
