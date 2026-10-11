"use client";

import { useState, useTransition } from "react";
import { updateLiquidationGoal } from "@/app/(dashboard)/liquidacion/actions";
import { Target, Edit2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, cn } from "@/lib/utils";
import type { GoalPace } from "@/lib/analytics/dead-stock";

interface Props {
  goalAmount: number;
  baseline: number;
  currentDeadStock: number;
  updatedAt: Date | null;
  deadline: string | null;
  pace: GoalPace | null;
}

const PACE_COPY: Record<GoalPace["status"], { label: string; tone: string }> = {
  met: { label: "Meta cumplida", tone: "text-primary" },
  on_track: { label: "Al ritmo", tone: "text-primary" },
  behind: { label: "Atrasada", tone: "text-warning" },
  overdue: { label: "Vencida", tone: "text-destructive" },
};

export function LiquidationGoalEditor({ goalAmount, baseline, currentDeadStock, updatedAt, deadline, pace }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(goalAmount > 0 ? String(goalAmount) : "");
  const [date, setDate] = useState(deadline ?? "");

  function handleSave() {
    const fd = new FormData();
    fd.set("amount", value);
    fd.set("deadline", date);
    startTransition(async () => {
      const r = await updateLiquidationGoal(fd);
      if (r.ok) {
        toast.success(`Meta actualizada: ${formatCurrency(Number(value))}`);
        setEditing(false);
      } else {
        toast.error(r.error ?? "Error al guardar");
      }
    });
  }

  const hasGoal = goalAmount > 0;
  const progress = hasGoal ? Math.max(baseline - currentDeadStock, 0) : 0;
  const pct = hasGoal ? (progress / goalAmount) * 100 : 0;
  const pctClamped = Math.min(Math.max(pct, 0), 100);

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
    <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Meta de liberación de caja</p>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Fijar meta"
          >
            <Edit2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground text-sm">$</span>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            autoFocus
            min="1"
            placeholder="Ej. 5000000"
            className="flex-1 rounded border border-border bg-input px-2 py-1 text-base font-bold focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={pending}
            aria-label="Fecha límite"
            className="rounded border border-border bg-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button onClick={handleSave} disabled={pending} className="rounded p-1.5 text-primary hover:bg-primary/10 disabled:opacity-50" title="Guardar">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { setEditing(false); setValue(goalAmount > 0 ? String(goalAmount) : ""); setDate(deadline ?? ""); }}
            disabled={pending}
            className="rounded p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : !hasGoal ? (
        <p className="text-sm font-medium text-muted-foreground">Sin meta fijada — click en el lápiz para fijar monto y fecha límite</p>
      ) : (
        <>
          <div className="flex items-end justify-between text-xs">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary">{formatCurrency(progress)}</span>
              <span className="text-muted-foreground">de {formatCurrency(goalAmount)}</span>
            </div>
            <span className="font-medium text-primary">{pct.toFixed(0)}%</span>
          </div>
          <div className="h-3 w-full rounded-full bg-secondary/40 overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pctClamped}%` }} />
          </div>
          {pace ? (
            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border text-xs">
              <div>
                <p className="text-muted-foreground">Estado</p>
                <p className={cn("font-semibold", PACE_COPY[pace.status].tone)}>{PACE_COPY[pace.status].label}</p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  {pace.daysLeft >= 0 ? `Faltan ${pace.daysLeft} días` : `Venció hace ${-pace.daysLeft} días`}
                </p>
                <p className="font-semibold">
                  {pace.remaining > 0 ? `${formatCurrency(pace.requiredPerWeek)}/sem` : "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Ritmo real</p>
                <p className="font-semibold">{pace.daysElapsed > 0 ? `${formatCurrency(pace.actualPerWeek)}/sem` : "—"}</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-warning">Sin fecha límite: fija una para medir el ritmo.</p>
          )}
        </>
      )}

      {lastUpdate && !editing && hasGoal && (
        <p className="text-xs text-muted-foreground">
          Meta fijada: {lastUpdate}
          {deadline && ` · límite ${new Date(`${deadline}T00:00:00Z`).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`}
        </p>
      )}
    </div>
  );
}
