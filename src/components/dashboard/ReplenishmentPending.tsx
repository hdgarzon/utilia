"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cancelOrder, markSent, retryOdooDraft, saveSupplier } from "@/app/(dashboard)/reabastecimiento/actions";
import type { PendingOrder } from "@/lib/analytics/replenishment";
import { buildOrderMessage, buildWaLink } from "@/lib/whatsapp";
import { formatCurrency, cn } from "@/lib/utils";
import { AlertTriangle, MessageCircle, Truck, X } from "lucide-react";

export function ReplenishmentPending({ pending }: { pending: PendingOrder[] }) {
  if (pending.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Truck className="h-4 w-4 text-primary" />
        <p className="font-semibold">Pedidos en curso ({pending.length})</p>
      </div>
      <div className="divide-y divide-border/60">
        {pending.map((o) => (
          <PendingRow key={o.id} order={o} />
        ))}
      </div>
    </div>
  );
}

function PendingRow({ order }: { order: PendingOrder }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [phoneDraft, setPhoneDraft] = useState("");

  const waLink = order.supplierPhone
    ? buildWaLink(
        order.supplierPhone,
        buildOrderMessage(
          order.supplierName,
          order.lines.map((l) => ({ qty: l.qty, name: l.productName }))
        )
      )
    : null;

  const sendWhatsApp = () => {
    if (!waLink) return;
    window.open(waLink, "_blank", "noopener,noreferrer");
    if (order.status === "APPROVED") {
      startTransition(async () => {
        const res = await markSent(order.id);
        if (!res.ok) toast.error(res.error ?? "No se pudo marcar como enviado");
        else router.refresh();
      });
    }
  };

  const cancel = () => {
    startTransition(async () => {
      const res = await cancelOrder(order.id);
      if (!res.ok) {
        toast.error(res.error ?? "No se pudo cancelar");
        return;
      }
      if (res.odooOrderName) {
        toast.info(`Cancelado en Utilia. Recuerda cancelar el borrador ${res.odooOrderName} en Odoo.`);
      } else {
        toast.success("Pedido cancelado");
      }
      router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm flex-wrap">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium">{order.supplierName}</p>
          <span className="text-xs text-muted-foreground">
            {order.lines.length} ítem{order.lines.length === 1 ? "" : "s"} · {formatCurrency(order.totalEstimated)}
          </span>
          {order.odooOrderName && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
              Odoo {order.odooOrderName}
            </span>
          )}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              order.status === "SENT" ? "bg-primary/10 text-primary" : "bg-warning/10 text-warning"
            )}
          >
            {order.status === "SENT" ? `enviado hace ${order.daysWaiting}d` : "aprobado, sin enviar"}
          </span>
          {order.delayed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
              <AlertTriangle className="h-3 w-3" />
              demorado — ¿reclamar?
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {waLink ? (
          <button
            onClick={sendWhatsApp}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {order.status === "SENT" ? "Reenviar WhatsApp" : "Enviar WhatsApp"}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              placeholder="WhatsApp del proveedor…"
              className="w-40 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
            <button
              onClick={() =>
                startTransition(async () => {
                  const res = await saveSupplier({ id: order.supplierId, name: order.supplierName, phone: phoneDraft });
                  if (!res.ok) toast.error(res.error ?? "No se pudo guardar");
                  else router.refresh();
                })
              }
              disabled={isPending || !phoneDraft.trim()}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        )}
        {!order.odooOrderId && (
          <button
            onClick={() =>
              startTransition(async () => {
                const res = await retryOdooDraft(order.id);
                if (!res.ok) toast.error(res.error ?? "Odoo falló de nuevo");
                else {
                  toast.success(`Borrador ${res.odooOrderName ?? ""} creado en Odoo`);
                  router.refresh();
                }
              })
            }
            disabled={isPending}
            className="rounded-lg border border-warning/50 px-2.5 py-1.5 text-xs text-warning hover:bg-warning/10 disabled:opacity-50"
          >
            Crear en Odoo
          </button>
        )}
        <button
          onClick={cancel}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
        >
          <X className="h-3.5 w-3.5" />
          Cancelar
        </button>
      </div>
    </div>
  );
}
