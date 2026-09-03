import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SeasonCategory {
  category: string;
  factor: number;
  productsBelowMin: number;
  years: number;
}

/**
 * Qué temporada viene y qué categorías se activan. Existe porque el ajuste
 * estacional cambia los mínimos sin decir por qué: sin esto, el dueño ve un
 * número distinto y no sabe si es un error o una decisión.
 */
export function SeasonAhead({
  fortnightLabel,
  categories,
}: {
  fortnightLabel: string;
  categories: SeasonCategory[];
}) {
  const suben = categories.filter((c) => c.factor > 1.05).sort((a, b) => b.factor - a.factor);
  const bajan = categories.filter((c) => c.factor < 0.95).sort((a, b) => a.factor - b.factor);
  if (suben.length === 0 && bajan.length === 0) return null;

  const unSoloAno = suben.some((c) => c.years < 2);

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm font-semibold">Lo que viene: {fortnightLabel}</p>
      </div>

      {suben.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suben.map((c) => (
            <span
              key={c.category}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
                c.productsBelowMin > 0
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-border bg-card"
              )}
            >
              <span className="font-medium">{c.category}</span>
              <span className="tabular-nums text-primary">×{c.factor.toFixed(1)}</span>
              {c.productsBelowMin > 0 && (
                <span className="text-destructive">· {c.productsBelowMin} por pedir</span>
              )}
            </span>
          ))}
        </div>
      )}

      {bajan.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Bajan: {bajan.map((c) => `${c.category} ×${c.factor.toFixed(1)}`).join(" · ")}
        </p>
      )}

      <p className="text-xs text-muted-foreground leading-relaxed">
        Los mínimos ya vienen ajustados a esta temporada, así que las sugerencias de pedido la tienen
        en cuenta.{" "}
        {unSoloAno && (
          <span className="text-warning">
            Algunas categorías se apoyan en un solo año de historia — tómalo como indicio, no como
            certeza.
          </span>
        )}
      </p>
    </div>
  );
}
