export const dynamic = "force-dynamic";

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getReplenishmentPlan } from "@/lib/analytics/replenishment";
import { ensureSuppliersFromHistory } from "@/lib/suppliers";
import { ReplenishmentBoard } from "@/components/dashboard/ReplenishmentBoard";
import { ReplenishmentPending } from "@/components/dashboard/ReplenishmentPending";
import { formatCurrency, cn } from "@/lib/utils";
import { ClipboardList, AlertTriangle, XCircle, Wallet } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ coverage?: string }>;
}

export default async function ReabastecimientoPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const coverage = Math.max(7, Math.min(90, Number(params.coverage) || 21));

  // El directorio se completa solo desde el historial (idempotente, volumen bajo).
  await ensureSuppliersFromHistory().catch(() => {});

  const plan = await getReplenishmentPlan(coverage).catch(() => null);
  const suppliers = await prisma.supplier.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true, odooPartnerId: true },
  });

  if (!plan) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Reabastecimiento</h1>
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Aún no hay datos para sugerir pedidos</p>
        </div>
      </div>
    );
  }

  const { totals } = plan;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Reabastecimiento</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pedido sugerido por proveedor — revisa, ajusta y aprueba; nada se envía solo
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Cobertura objetivo:</span>
          {[14, 21, 30, 45].map((d) => (
            <Link
              key={d}
              href={`/reabastecimiento?coverage=${d}`}
              className={cn(
                "rounded-lg border px-3 py-1.5 font-medium transition-colors",
                d === plan.coverageDaysTarget
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card hover:bg-secondary"
              )}
            >
              {d}d
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-center">
          <XCircle className="h-5 w-5 text-destructive mx-auto mb-1" />
          <p className="text-2xl font-bold text-destructive">{totals.criticalCount}</p>
          <p className="text-xs text-muted-foreground">críticos (&lt;7 días)</p>
        </div>
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-center">
          <AlertTriangle className="h-5 w-5 text-warning mx-auto mb-1" />
          <p className="text-2xl font-bold text-warning">{totals.warningCount}</p>
          <p className="text-xs text-muted-foreground">advertencia (7–14 días)</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <ClipboardList className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-2xl font-bold">{formatCurrency(totals.estimated)}</p>
          <p className="text-xs text-muted-foreground">pedido sugerido (clase A/B)</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <Wallet className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className={cn("text-2xl font-bold", totals.gap > 0 ? "text-destructive" : "text-primary")}>
            {totals.gap > 0 ? `−${formatCurrency(totals.gap)}` : formatCurrency(totals.reinvestmentFund)}
          </p>
          <p className="text-xs text-muted-foreground">
            {totals.gap > 0 ? "faltante vs Fondo de Reposición" : "Fondo de Reposición disponible"}
          </p>
        </div>
      </div>

      <ReplenishmentPending pending={plan.pending} />

      <ReplenishmentBoard
        suggestions={plan.suggestions}
        unassigned={plan.unassigned}
        suppliers={suppliers}
      />
    </div>
  );
}
