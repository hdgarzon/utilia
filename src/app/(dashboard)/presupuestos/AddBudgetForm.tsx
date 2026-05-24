"use client";

import { useState, useTransition } from "react";
import { upsertBudget } from "./actions";
import { Plus } from "lucide-react";
import { toast } from "sonner";

interface Props {
  month: number;
  year: number;
}

export function AddBudgetForm({ month, year }: Props) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!category || !amount) {
      toast.error("Completa categoría y monto");
      return;
    }
    const fd = new FormData();
    fd.set("category", category);
    fd.set("month", String(month));
    fd.set("year", String(year));
    fd.set("budgetAmount", amount);
    fd.set("alertPct", "90");
    startTransition(async () => {
      const r = await upsertBudget(fd);
      if (r.ok) {
        toast.success("Presupuesto creado");
        setCategory("");
        setAmount("");
        setOpen(false);
      } else {
        toast.error(r.error ?? "Error");
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
      >
        <Plus className="h-3.5 w-3.5" />
        Nueva categoría
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Categoría</label>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={pending}
          autoFocus
          placeholder="ej. Internet"
          className="rounded border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Monto mensual (COP)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={pending}
          placeholder="500000"
          className="w-40 rounded border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        Crear
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setCategory(""); setAmount(""); }}
        disabled={pending}
        className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
      >
        Cancelar
      </button>
    </form>
  );
}
