"use client";

import { useState, useTransition } from "react";
import { updateCashBalance } from "@/app/(dashboard)/financiero/actions";
import { Wallet, Edit2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";

interface Props {
  currentBalance: number;
  updatedAt: Date | null;
}

export function CashBalanceEditor({ currentBalance, updatedAt }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(String(currentBalance));

  function handleSave() {
    const fd = new FormData();
    fd.set("amount", value);
    startTransition(async () => {
      const r = await updateCashBalance(fd);
      if (r.ok) {
        toast.success(`Saldo actualizado: ${formatCurrency(Number(value))}`);
        setEditing(false);
      } else {
        toast.error(r.error ?? "Error al guardar");
      }
    });
  }

  const lastUpdate = updatedAt
    ? new Date(updatedAt).toLocaleString("es-CO", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Bogota",
      })
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Wallet className="h-3.5 w-3.5 text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Saldo en caja</p>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Actualizar saldo"
          >
            <Edit2 className="h-3 w-3" />
          </button>
        )}
      </div>
      {editing ? (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-sm">$</span>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            autoFocus
            min="0"
            className="flex-1 rounded border border-border bg-input px-2 py-1 text-base font-bold focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={handleSave}
            disabled={pending}
            className={cn("rounded p-1.5 text-primary hover:bg-primary/10 disabled:opacity-50")}
            title="Guardar"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { setEditing(false); setValue(String(currentBalance)); }}
            disabled={pending}
            className="rounded p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <p className="text-2xl font-bold text-primary">{formatCurrency(currentBalance)}</p>
      )}
      {lastUpdate && !editing && (
        <p className="text-xs text-muted-foreground">Actualizado: {lastUpdate}</p>
      )}
    </div>
  );
}
