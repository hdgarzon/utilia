"use client";

import { useState, useTransition } from "react";
import { cloneBudgets } from "./actions";
import { Copy, X } from "lucide-react";
import { toast } from "sonner";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

interface Props {
  currentMonth: number;
  currentYear: number;
}

export function CloneBudgets({ currentMonth, currentYear }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Default: copiar del mes actual hacia el anterior
  const prevDate = new Date(currentYear, currentMonth - 2, 1);
  const [targetMonth, setTargetMonth] = useState(prevDate.getMonth() + 1);
  const [targetYear, setTargetYear] = useState(prevDate.getFullYear());
  const [copyActuals, setCopyActuals] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const targetLabel = `${MONTHS[targetMonth - 1]} ${targetYear}`;
    const sourceLabel = `${MONTHS[currentMonth - 1]} ${currentYear}`;
    if (!confirm(`Copiar presupuestos de ${sourceLabel} → ${targetLabel}?\n\n${copyActuals ? "Se copiarán también los ejecutados (solo donde el destino esté en 0)" : "Solo se copiarán los montos presupuestados, no los ejecutados"}`)) {
      return;
    }

    const fd = new FormData();
    fd.set("sourceMonth", String(currentMonth));
    fd.set("sourceYear", String(currentYear));
    fd.set("targetMonth", String(targetMonth));
    fd.set("targetYear", String(targetYear));
    fd.set("copyActuals", String(copyActuals));

    startTransition(async () => {
      const r = await cloneBudgets(fd);
      if (r.ok) {
        toast.success(`${r.cloned ?? 0} creados · ${r.updated ?? 0} actualizados`, {
          description: `Copiados a ${targetLabel}`,
        });
        setOpen(false);
      } else {
        toast.error(r.error ?? "Error al clonar");
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-secondary transition-colors"
        title="Copiar presupuestos a otro mes"
      >
        <Copy className="h-3.5 w-3.5" />
        Clonar a otro mes
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Mes destino</label>
        <select
          value={targetMonth}
          onChange={(e) => setTargetMonth(Number(e.target.value))}
          disabled={pending}
          className="rounded border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {MONTHS.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Año</label>
        <input
          type="number"
          value={targetYear}
          onChange={(e) => setTargetYear(Number(e.target.value))}
          disabled={pending}
          min="2020"
          max="2100"
          className="w-20 rounded border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <label className="flex items-center gap-1.5 cursor-pointer pb-1.5">
        <input
          type="checkbox"
          checked={copyActuals}
          onChange={(e) => setCopyActuals(e.target.checked)}
          disabled={pending}
          className="rounded border-border"
        />
        <span className="text-xs text-muted-foreground">Incluir ejecutados</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Copiando…" : "Copiar"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={pending}
        className="rounded p-1.5 text-muted-foreground hover:bg-secondary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}
