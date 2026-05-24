"use client";

import { useState, useTransition } from "react";
import { recordExpense } from "./actions";
import { Receipt, X } from "lucide-react";
import { toast } from "sonner";

interface Budget {
  id: string;
  category: string;
}

interface Props {
  budgets: Budget[];
}

export function RecordExpense({ budgets }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [budgetId, setBudgetId] = useState(budgets[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!budgetId || !amount) {
      toast.error("Categoría y monto requeridos");
      return;
    }
    const fd = new FormData();
    fd.set("budgetId", budgetId);
    fd.set("amount", amount);
    if (note) fd.set("note", note);
    startTransition(async () => {
      const r = await recordExpense(fd);
      if (r.ok) {
        const cat = budgets.find((b) => b.id === budgetId)?.category ?? "categoría";
        toast.success(`Gasto de ${Number(amount).toLocaleString("es-CO")} registrado en ${cat}`);
        setAmount("");
        setNote("");
      } else {
        toast.error(r.error ?? "Error al registrar");
      }
    });
  }

  if (budgets.length === 0) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
      >
        <Receipt className="h-3.5 w-3.5" />
        Registrar gasto
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" />
          Registrar gasto real
        </h3>
        <button
          onClick={() => setOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-secondary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Categoría</label>
          <select
            value={budgetId}
            onChange={(e) => setBudgetId(e.target.value)}
            disabled={pending}
            className="rounded border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>{b.category}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Monto (COP)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
            placeholder="50000"
            autoFocus
            className="w-32 rounded border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="space-y-1 flex-1 min-w-48">
          <label className="text-xs text-muted-foreground">Nota (opcional)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
            placeholder="ej. recibo EPM mayo"
            maxLength={200}
            className="w-full rounded border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Registrando..." : "Registrar"}
        </button>
      </form>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Esto suma al &quot;Ejecutado&quot; de la categoría. Si tu Odoo registrara los gastos en{" "}
        <code className="rounded bg-secondary px-1 py-0.5 text-foreground">account.move</code>, se sincronizaría
        automático. Mientras tanto, este es el camino rápido sin tocar Odoo.
      </p>
    </div>
  );
}
