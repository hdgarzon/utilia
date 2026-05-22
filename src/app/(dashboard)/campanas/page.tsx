import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { MessageSquare, Plus, Send, Pause } from "lucide-react";
import Link from "next/link";

async function getCampaignsData() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { _count: { select: { executions: true } } },
  });
  return { campaigns };
}

const statusLabel: Record<string, string> = {
  DRAFT: "Borrador",
  SCHEDULED: "Programada",
  RUNNING: "Ejecutando",
  COMPLETED: "Completada",
  PAUSED: "Pausada",
  CANCELLED: "Cancelada",
};

const statusColor: Record<string, string> = {
  DRAFT: "text-muted-foreground bg-muted",
  SCHEDULED: "text-warning bg-warning/10",
  RUNNING: "text-primary bg-primary/10",
  COMPLETED: "text-primary bg-primary/10",
  PAUSED: "text-warning bg-warning/10",
  CANCELLED: "text-destructive bg-destructive/10",
};

export default async function CampanasPage() {
  const { campaigns } = await getCampaignsData();

  const stats = {
    total: campaigns.length,
    active: campaigns.filter((c) => c.status === "RUNNING").length,
    totalSent: campaigns.reduce((sum, c) => sum + c.totalSent, 0),
    totalRevenue: campaigns.reduce((sum, c) => sum + c.revenueAttr, 0),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Centro de Campañas</h1>
        <Link
          href="/dashboard/campanas/nueva"
          className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva Campaña
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Total Campañas</p>
          <p className="text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Activas</p>
          <p className="text-2xl font-bold text-primary">{stats.active}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Mensajes Enviados</p>
          <p className="text-2xl font-bold">{stats.totalSent.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Ingresos Atribuidos</p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(stats.totalRevenue)}</p>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center space-y-3">
          <MessageSquare className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">No hay campañas todavía</p>
          <p className="text-xs text-muted-foreground">Crea tu primera campaña de WhatsApp para llegar a tus clientes</p>
          <Link
            href="/dashboard/campanas/nueva"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" />
            Crear primera campaña
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Campañas Recientes</h3>
          <div className="space-y-3">
            {campaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium", statusColor[c.status])}>
                      {statusLabel[c.status]}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.totalSent} enviados · {c.totalRead} leídos
                    {c.revenueAttr > 0 && ` · ${formatCurrency(c.revenueAttr)} atribuidos`}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {c.status === "DRAFT" && (
                    <button className="rounded p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {c.status === "RUNNING" && (
                    <button className="rounded p-1.5 text-muted-foreground hover:bg-warning/10 hover:text-warning transition-colors">
                      <Pause className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
