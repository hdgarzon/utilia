"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, RefreshCw, Search, Check, Loader2, Sparkles, Save } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  regenerateCopyAction,
  updateDiscountAction,
  markPostedAction,
  setTemplateAction,
  pickProductAction,
  updateGanchoAction,
  suggestGanchoAction,
} from "@/app/(dashboard)/campanas/status-actions";
import { ProductPickerDialog, type PickerProduct } from "./ProductPickerDialog";
import { AddStatusPost } from "./AddStatusPost";

export interface StatusPostView {
  id: string;
  slot: number;
  kind: "PRODUCT" | "GANCHO";
  odooProductId: number | null;
  productName: string | null;
  stockQty: number | null;
  salePrice: number | null;
  discountPct: number | null;
  finalPrice: number | null;
  copy: string | null;
  headline: string | null;
  subhead: string | null;
  posted: boolean;
  template: "A" | "B" | "C";
  version: number; // updatedAt en ms, para cache-bust de la imagen
}

/** Preview 9:16 del estado con los overlays de publicado / cargando. */
function StatusPreview({ imgUrl, alt, posted, pending }: { imgUrl: string; alt: string; posted: boolean; pending: boolean }) {
  return (
    <div className="relative mx-auto w-full max-w-[220px] overflow-hidden rounded-lg" style={{ aspectRatio: "9 / 16" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imgUrl} alt={alt} className="h-full w-full object-cover" />
      {posted && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <span className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
            <Check className="h-3.5 w-3.5" /> Publicado
          </span>
        </div>
      )}
      {pending && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      )}
    </div>
  );
}

function StatusCard({
  post,
  excludeIds,
  liquidacionPool,
  regularPool,
}: {
  post: StatusPostView;
  excludeIds: number[];
  liquidacionPool: PickerProduct[];
  regularPool: PickerProduct[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [pct, setPct] = useState(String(Math.round(post.discountPct ?? 0)));
  const [pickerOpen, setPickerOpen] = useState(false);
  const imgUrl = `/api/estados/${post.id}?v=${post.version}`;

  function run(action: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setActiveAction(action);
    startTransition(async () => {
      const r = await fn();
      setActiveAction(null);
      if (r.ok) {
        toast.success(okMsg);
        router.refresh();
      } else {
        toast.error(r.error ?? "Error");
      }
    });
  }

  function handlePick(odooProductId: number) {
    setPickerOpen(false);
    run("product", () => pickProductAction(post.id, odooProductId), "Producto actualizado");
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      <StatusPreview imgUrl={imgUrl} alt={post.productName ?? ""} posted={post.posted} pending={pending} />

      <div className="text-center">
        <p className="truncate text-sm font-semibold" title={post.productName ?? ""}>{post.productName}</p>
        <p className="text-xs text-muted-foreground">
          Stock {post.stockQty ?? 0} · <span className="line-through">{formatCurrency(post.salePrice ?? 0)}</span>{" "}
          <span className="font-semibold text-foreground">{formatCurrency(post.finalPrice ?? 0)}</span>
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Plantilla</span>
        <div className="ml-auto flex gap-1">
          {(["A", "B", "C"] as const).map((t) => (
            <button
              key={t}
              disabled={pending}
              onClick={() => run(`template-${t}`, () => setTemplateAction(post.id, t), `Plantilla ${t}`)}
              className={cn(
                "h-7 w-7 rounded text-xs font-bold disabled:opacity-50",
                post.template === t
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:bg-secondary"
              )}
            >
              {activeAction === `template-${t}` && pending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Desc.</span>
        <input
          type="number"
          min={0}
          max={90}
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          className="w-16 rounded border border-border bg-background px-2 py-1 text-sm"
        />
        <span className="text-xs text-muted-foreground">%</span>
        <button
          disabled={pending}
          onClick={() => run("discount", () => updateDiscountAction(post.id, Number(pct)), "Descuento actualizado")}
          className="ml-auto flex items-center gap-1.5 rounded bg-secondary px-2 py-1 text-xs font-medium hover:bg-secondary/80 disabled:opacity-50"
        >
          {activeAction === "discount" && pending && <Loader2 className="h-3 w-3 animate-spin" />}
          Aplicar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <a
          href={imgUrl}
          download={`estado-utilia-${post.slot}.png`}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          <Download className="h-3.5 w-3.5" /> Descargar
        </a>
        <button
          disabled={pending}
          onClick={() => run("posted", () => markPostedAction(post.id, !post.posted), post.posted ? "Marcado pendiente" : "Marcado publicado")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50",
            post.posted ? "bg-secondary text-foreground" : "border border-border hover:bg-secondary"
          )}
        >
          {activeAction === "posted" && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {post.posted ? "Publicado" : "Marcar"}
        </button>
        <button
          disabled={pending}
          onClick={() => run("copy", () => regenerateCopyAction(post.id), "Texto regenerado")}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          {activeAction === "copy" && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Texto
        </button>
        <button
          disabled={pending}
          onClick={() => setPickerOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          {activeAction === "product" && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Elegir producto
        </button>
      </div>

      <ProductPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        liquidacionPool={liquidacionPool}
        regularPool={regularPool}
        excludeIds={excludeIds}
        onPick={handlePick}
        pending={pending}
      />
    </div>
  );
}

/** Tarjeta de un gancho: preview + edición de titular/subtítulo con sugerencia IA. */
function GanchoCard({ post }: { post: StatusPostView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [headline, setHeadline] = useState(post.headline ?? "");
  const [subhead, setSubhead] = useState(post.subhead ?? "");
  const imgUrl = `/api/estados/${post.id}?v=${post.version}`;
  const dirty = headline !== (post.headline ?? "") || subhead !== (post.subhead ?? "");

  function save() {
    if (!headline.trim()) {
      toast.error("El titular no puede estar vacío");
      return;
    }
    setActiveAction("save");
    startTransition(async () => {
      const r = await updateGanchoAction(post.id, headline, subhead);
      setActiveAction(null);
      if (r.ok) {
        toast.success("Gancho actualizado");
        router.refresh();
      } else {
        toast.error(r.error ?? "Error");
      }
    });
  }

  function suggest() {
    setActiveAction("suggest");
    startTransition(async () => {
      const r = await suggestGanchoAction(headline);
      setActiveAction(null);
      if (r.ok) {
        setHeadline(r.text.headline);
        setSubhead(r.text.subhead);
        toast.success("Sugerencia lista — recuerda guardar");
      } else {
        toast.error(r.error ?? "Error");
      }
    });
  }

  function togglePosted() {
    setActiveAction("posted");
    startTransition(async () => {
      const r = await markPostedAction(post.id, !post.posted);
      setActiveAction(null);
      if (r.ok) {
        toast.success(post.posted ? "Marcado pendiente" : "Marcado publicado");
        router.refresh();
      } else {
        toast.error(r.error ?? "Error");
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      <StatusPreview imgUrl={imgUrl} alt={post.headline ?? "Gancho"} posted={post.posted} pending={pending} />

      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Sparkles className="h-3 w-3" /> Gancho
      </span>

      <div className="space-y-1.5">
        <input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="Titular de intriga"
          maxLength={60}
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm font-semibold"
        />
        <input
          value={subhead}
          onChange={(e) => setSubhead(e.target.value)}
          placeholder="Subtítulo (opcional)"
          maxLength={90}
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          disabled={pending}
          onClick={suggest}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          {activeAction === "suggest" && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Sugerir
        </button>
        <button
          disabled={pending || !dirty}
          onClick={save}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {activeAction === "save" && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Guardar
        </button>
        <a
          href={imgUrl}
          download={`estado-utilia-${post.slot}.png`}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary",
            dirty && "pointer-events-none opacity-40"
          )}
          title={dirty ? "Guarda los cambios antes de descargar" : undefined}
        >
          <Download className="h-3.5 w-3.5" /> Descargar
        </a>
        <button
          disabled={pending}
          onClick={togglePosted}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50",
            post.posted ? "bg-secondary text-foreground" : "border border-border hover:bg-secondary"
          )}
        >
          {activeAction === "posted" && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {post.posted ? "Publicado" : "Marcar"}
        </button>
      </div>
    </div>
  );
}

export function StatusPostsToday({
  posts,
  liquidacionPool,
  regularPool,
}: {
  posts: StatusPostView[];
  liquidacionPool: PickerProduct[];
  regularPool: PickerProduct[];
}) {
  if (posts.length === 0) return null;
  // Ids de producto en uso hoy (los ganchos no tienen producto → se descartan).
  const usedToday = posts.map((p) => p.odooProductId).filter((id): id is number => id != null);
  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">
          Estados de hoy para WhatsApp
          <span className="ml-1.5 font-normal text-muted-foreground">({posts.length})</span>
        </h3>
        <p className="text-xs text-muted-foreground">
          Descarga cada imagen y súbela a tu Estado de WhatsApp. Los primeros salen solos para mover
          capital muerto; podés generar más cuando quieras. Descargar → WhatsApp → Estado → subir la imagen.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((p) =>
          p.kind === "GANCHO" ? (
            <GanchoCard key={p.id} post={p} />
          ) : (
            <StatusCard
              key={p.id}
              post={p}
              excludeIds={usedToday.filter((id) => id !== p.odooProductId)}
              liquidacionPool={liquidacionPool}
              regularPool={regularPool}
            />
          )
        )}
      </div>
      <AddStatusPost
        liquidacionPool={liquidacionPool}
        regularPool={regularPool}
        excludeIds={usedToday}
      />
    </div>
  );
}
