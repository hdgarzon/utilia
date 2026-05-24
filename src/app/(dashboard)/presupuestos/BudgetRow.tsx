"use client";

import { useState, useTransition } from "react";
import { upsertBudget, deleteBudget } from "./actions";
import { formatCurrency, cn } from "@/lib/utils";
import { Check, X, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Budget {
  id: string;
  category: string;
  month: number;
  year: number;
  budgetAmount: number;
  actualAmount: number;
  alertPct: number;
}

interface Props {
  budget: Budget;
}

export function BudgetRow({ budget }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(String(budget.budgetAmount));
  const [alertPct, setAlertPct] = useState(String(budget.alertPct));

  const pct = budget.budgetAmount > 0 ? (budget.actualAmount / budget.budgetAmount) * 100 : 0;
  const isOver = pct >= 100;
  const isAlert = pct >= budget.alertPct;

  function handleSave() {
    const fd = new FormData();
    fd.set("id", budget.id);
    fd.set("category", budget.category);
    fd.set("month", String(budget.month));
    fd.set("year", String(budget.year));
    fd.set("budgetAmount", amount);
    fd.set("alertPct", alertPct);
    startTransition(async () => {
      const r = await upsertBudget(fd);
      if (r.ok) {
        toast.success("Presupuesto actualizado");
        setEditing(false);
      } else {
        toast.error(r.error ?? "Error al guardar");
      }
    });
  }

  function handleDelete() {
    if (!confirm(`¿Borrar presupuesto de "${budget.category}"?`)) return;
    startTransition(async () => {
      const r = await deleteBudget(budget.id);
      if (r.ok) toast.success("Eliminado");
      else toast.error(r.error ?? "Error al eliminar");
    });
  }

  return (
    <tr className="border-b border-border last:border-0 hover:bg-secondary/20">
      <td className="px-4 py-3 font-medium">{budget.category}</td>
      <td className="px-4 py-3 text-right">
        {editing ? (
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
            className="w-32 rounded border border-border bg-input px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <span className="text-sm font-medium">{formatCurrency(budget.budgetAmount)}</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <span className={cn("text-sm font-medium", isOver ? "text-destructive" : isAlert ? "text-warning" : "text-foreground")}>
          {formatCurrency(budget.actualAmount)}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-secondary/40 overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all",
                isOver ? "bg-destructive" : isAlert ? "bg-warning" : "bg-primary"
              )}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className={cn("text-xs font-medium w-12 text-right",
            isOver ? "text-destructive" : isAlert ? "text-warning" : "text-muted-foreground"
          )}>
            {pct.toFixed(0)}%
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        {editing ? (
          <input
            type="number"
            value={alertPct}
            onChange={(e) => setAlertPct(e.target.value)}
            disabled={pending}
            min="50"
            max="150"
            className="w-16 rounded border border-border bg-input px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <span className="text-xs text-muted-foreground">{budget.alertPct}%</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={pending}
                className="rounded p-1.5 text-primary hover:bg-primary/10 disabled:opacity-50"
                title="Guardar"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => { setEditing(false); setAmount(String(budget.budgetAmount)); setAlertPct(String(budget.alertPct)); }}
                disabled={pending}
                className="rounded p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-50"
                title="Cancelar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="rounded p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                title="Editar"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleDelete}
                disabled={pending}
                className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                title="Eliminar"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
