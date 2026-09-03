"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { setLeadTimeAction } from "@/app/(dashboard)/reabastecimiento/actions";

/**
 * Dias de entrega del proveedor. Es el dato que mas mueve el punto de reorden:
 * si el proveedor tarda el doble, hay que pedir con el doble de anticipacion.
 * Mientras el modulo acumula tiempos reales por proveedor, se ajusta a mano.
 */
export function LeadTimeSetting({ current }: { current: number }) {
  const router = useRouter();
  const [days, setDays] = useState(String(current));
  const [isPending, startTransition] = useTransition();
  const dirty = days !== String(current);

  const save = () =>
    startTransition(async () => {
      const res = await setLeadTimeAction(Number(days));
      if (!res.ok) {
        toast.error(res.error ?? "No se pudo guardar");
        return;
      }
      toast.success(`Niveles recalculados · ${res.withLevels ?? 0} productos con mínimo y máximo`);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-xs">
      <Truck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <label htmlFor="lead-time" className="text-muted-foreground">
        Días de entrega del proveedor
      </label>
      <input
        id="lead-time"
        type="number"
        inputMode="numeric"
        min={1}
        max={120}
        value={days}
        onChange={(e) => setDays(e.target.value)}
        className="w-16 rounded-md border border-border bg-background px-2 py-1.5 text-right"
      />
      <button
        type="button"
        onClick={save}
        disabled={isPending || !dirty}
        className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-secondary disabled:opacity-40"
      >
        {isPending ? "Recalculando…" : "Guardar"}
      </button>
      <span className="text-muted-foreground">
        Define el punto de reorden: cuánto se vende mientras llega el pedido, más un colchón por variabilidad.
      </span>
    </div>
  );
}
