"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, RefreshCw, Search, Check } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  regenerateCopyAction,
  updateDiscountAction,
  markPostedAction,
  setTemplateAction,
  pickProductAction,
} from "@/app/(dashboard)/campanas/status-actions";
import { ProductPickerDialog, type PickerProduct } from "./ProductPickerDialog";

export interface StatusPostView {
  id: string;
  slot: number;
  odooProductId: number;
  productName: string;
  stockQty: number;
  salePrice: number;
  discountPct: number;
  finalPrice: number;
  copy: string;
  posted: boolean;
  template: "A" | "B" | "C";
  version: number; // updatedAt en ms, para cache-bust de la imagen
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
  const [pct, setPct] = useState(String(Math.round(post.discountPct)));
  const [pickerOpen, setPickerOpen] = useState(false);
  const imgUrl = `/api/estados/${post.id}?v=${post.version}`;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const r = await fn();
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
    run(() => pickProductAction(post.id, odooProductId), "Producto actualizado");
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      <div className="relative mx-auto w-full max-w-[220px] overflow-hidden rounded-lg" style={{ aspectRatio: "9 / 16" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imgUrl} alt={post.productName} className="h-full w-full object-cover" />
        {post.posted && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <span className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
              <Check className="h-3.5 w-3.5" /> Publicado
            </span>
          </div>
        )}
      </div>

      <div className="text-center">
        <p className="truncate text-sm font-semibold" title={post.productName}>{post.productName}</p>
        <p className="text-xs text-muted-foreground">
          Stock {post.stockQty} · <span className="line-through">{formatCurrency(post.salePrice)}</span>{" "}
          <span className="font-semibold text-foreground">{formatCurrency(post.finalPrice)}</span>
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Plantilla</span>
        <div className="ml-auto flex gap-1">
          {(["A", "B", "C"] as const).map((t) => (
            <button
              key={t}
              disabled={pending}
              onClick={() => run(() => setTemplateAction(post.id, t), `Plantilla ${t}`)}
              className={cn(
                "h-7 w-7 rounded text-xs font-bold disabled:opacity-50",
                post.template === t
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:bg-secondary"
              )}
            >
              {t}
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
          onClick={() => run(() => updateDiscountAction(post.id, Number(pct)), "Descuento actualizado")}
          className="ml-auto rounded bg-secondary px-2 py-1 text-xs font-medium hover:bg-secondary/80 disabled:opacity-50"
        >
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
          onClick={() => run(() => markPostedAction(post.id, !post.posted), post.posted ? "Marcado pendiente" : "Marcado publicado")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50",
            post.posted ? "bg-secondary text-foreground" : "border border-border hover:bg-secondary"
          )}
        >
          <Check className="h-3.5 w-3.5" /> {post.posted ? "Publicado" : "Marcar"}
        </button>
        <button
          disabled={pending}
          onClick={() => run(() => regenerateCopyAction(post.id), "Texto regenerado")}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Texto
        </button>
        <button
          disabled={pending}
          onClick={() => setPickerOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" /> Elegir producto
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
  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Estados de hoy para WhatsApp</h3>
        <p className="text-xs text-muted-foreground">
          Descarga cada imagen y súbela a tu Estado de WhatsApp. 3 al día para mover capital muerto.
          Descargar → WhatsApp → Estado → subir la imagen.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((p) => (
          <StatusCard
            key={p.id}
            post={p}
            excludeIds={posts.filter((o) => o.id !== p.id).map((o) => o.odooProductId)}
            liquidacionPool={liquidacionPool}
            regularPool={regularPool}
          />
        ))}
      </div>
    </div>
  );
}
