"use client";

import { Zap, ChevronRight, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SectionCard } from "./SectionCard";

interface AIRecommendation {
  id: string;
  type: string;
  priority: string;
  title: string;
  content: string;
  impact?: number;
  applied: boolean;
  dismissed: boolean;
}

interface AIFeedProps {
  recommendations: AIRecommendation[];
}

const typeLabel: Record<string, string> = {
  restock: "Reabastecer",
  promote: "Promover",
  discontinue: "Descontinuar",
  campaign: "Campaña",
  price: "Precio",
  financial: "Financiero",
};

const priorityColor: Record<string, string> = {
  high: "text-destructive bg-destructive/10",
  medium: "text-warning bg-warning/10",
  low: "text-muted-foreground bg-muted",
};

export function AIFeed({ recommendations }: AIFeedProps) {
  async function handleApply(id: string) {
    await fetch(`/api/recommendations/${id}/apply`, { method: "POST" });
    toast.success("Recomendación aplicada");
  }

  async function handleDismiss(id: string) {
    await fetch(`/api/recommendations/${id}/dismiss`, { method: "POST" });
    toast.info("Recomendación descartada");
  }

  const active = recommendations.filter((r) => !r.applied && !r.dismissed);

  return (
    <SectionCard
      title="Recomendaciones IA"
      icon={<Zap />}
      action={
        active.length > 0 ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{active.length}</span>
        ) : undefined
      }
      bodyClassName="space-y-3"
    >
      {active.length === 0 && (
        <p className="text-xs text-muted-foreground">Sin recomendaciones nuevas</p>
      )}

      <div className="space-y-3">
        {active.slice(0, 4).map((rec) => (
          <div key={rec.id} className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", priorityColor[rec.priority])}>
                {typeLabel[rec.type] ?? rec.type}
              </span>
              <p className="text-xs font-semibold text-foreground truncate">{rec.title}</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{rec.content}</p>
            {rec.impact && (
              <p className="text-xs text-primary font-medium">Impacto estimado: +${rec.impact.toLocaleString()}</p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => handleApply(rec.id)}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <CheckCircle className="h-3 w-3" />
                Aplicar
              </button>
              <button
                onClick={() => handleDismiss(rec.id)}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors"
              >
                <XCircle className="h-3 w-3" />
                Ignorar
              </button>
              <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground" />
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
