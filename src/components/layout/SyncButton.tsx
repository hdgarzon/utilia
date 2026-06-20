"use client";

import { useState, useTransition } from "react";
import { RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface SyncSummary {
  job: string;
  status: "fulfilled" | "rejected";
  synced?: number;
  error?: string;
}

interface SyncResponse {
  ok?: boolean;
  durationMs?: number;
  summary?: SyncSummary[];
  ai?: { generated?: number; detected?: number };
  error?: string;
}

const JOB_LABEL: Record<string, string> = {
  products: "productos",
  stock: "stock",
  sales: "ventas",
};

export function SyncButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<"success" | "error" | null>(null);

  function handleSync() {
    startTransition(async () => {
      const t0 = Date.now();
      try {
        const res = await fetch("/api/sync", { method: "POST" });
        const data: SyncResponse = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        // Construir mensaje legible del resumen
        const parts: string[] = [];
        if (data.summary) {
          for (const s of data.summary) {
            if (s.status === "fulfilled" && s.synced !== undefined) {
              parts.push(`${s.synced} ${JOB_LABEL[s.job] ?? s.job}`);
            }
          }
        }
        const aiPart =
          data.ai && typeof data.ai === "object" && "generated" in data.ai
            ? ` + ${data.ai.generated} recomendaciones IA`
            : "";
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);

        toast.success(
          `Sync completo en ${elapsed}s`,
          { description: `${parts.join(" · ")}${aiPart}` }
        );
        setLastResult("success");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error("Sync falló", { description: msg.slice(0, 120) });
        setLastResult("error");
      } finally {
        // Refrescar SIEMPRE, también si hubo error/timeout: el server pudo haber
        // escrito parte de los datos, así la UI queda al día sin recargar a mano.
        router.refresh();
      }
    });
  }

  const Icon = pending ? RefreshCw : lastResult === "success" ? CheckCircle2 : lastResult === "error" ? AlertCircle : RefreshCw;
  const tone = lastResult === "success" ? "text-primary" : lastResult === "error" ? "text-destructive" : "text-muted-foreground";

  return (
    <button
      onClick={handleSync}
      disabled={pending}
      title="Sincronizar datos desde Odoo + regenerar recomendaciones IA"
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition-colors",
        "hover:bg-secondary disabled:opacity-60 disabled:cursor-wait"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", pending && "animate-spin", tone)} />
      <span>{pending ? "Sincronizando…" : "Sincronizar"}</span>
    </button>
  );
}
