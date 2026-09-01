"use client";

import { useMemo, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  approveOrder,
  assignSupplier,
  importSuppliersAction,
  saveSupplier,
} from "@/app/(dashboard)/reabastecimiento/actions";
import type {
  ReplenishmentSuggestion,
  SuggestionLine,
} from "@/lib/analytics/replenishment";
import { formatCurrency, cn } from "@/lib/utils";
import { Check, ChevronDown, ChevronRight, Store, Trash2, UserPlus } from "lucide-react";

interface SupplierOption {
  id: string;
  name: string;
  phone: string | null;
  odooPartnerId: number | null;
}

interface Props {
  suggestions: ReplenishmentSuggestion[];
  unassigned: ReplenishmentSuggestion;
  suppliers: SupplierOption[];
}

const reasonBadge: Record<SuggestionLine["reason"], { label: string; cls: string }> = {
  critico: { label: "crítico", cls: "bg-destructive/10 text-destructive" },
  advertencia: { label: "advertencia", cls: "bg-warning/10 text-warning" },
  min_stock: { label: "mín. stock", cls: "bg-secondary text-muted-foreground" },
};

export function ReplenishmentBoard({ suggestions, unassigned, suppliers }: Props) {
  return (
    <div className="space-y-4">
      {suggestions.length === 0 && unassigned.lines.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Sin pedidos sugeridos — vas bien de stock
        </div>
      )}
      {suggestions.map((s) => (
        <SupplierCard key={s.supplier!.id} suggestion={s} />
      ))}
      {unassigned.lines.length > 0 && <UnassignedCard unassigned={unassigned} suppliers={suppliers} />}
    </div>
  );
}

function SupplierCard({ suggestion }: { suggestion: ReplenishmentSuggestion }) {
  const supplier = suggestion.supplier!;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);
  const [showC, setShowC] = useState(false);
  // qty editable por producto; las C arrancan en 0 (no preseleccionadas)
  const [qty, setQty] = useState<Record<number, number>>(() =>
    Object.fromEntries(suggestion.lines.map((l) => [l.odooProductId, l.tier === "C" ? 0 : l.suggestedQty]))
  );

  const abLines = suggestion.lines.filter((l) => l.tier !== "C");
  const cLines = suggestion.lines.filter((l) => l.tier === "C");
  const activeLines = suggestion.lines.filter((l) => (qty[l.odooProductId] ?? 0) > 0);
  const total = useMemo(
    () => activeLines.reduce((s, l) => s + (qty[l.odooProductId] ?? 0) * l.unitCost, 0),
    [activeLines, qty]
  );

  if (dismissed) return null;

  const approve = () => {
    if (activeLines.length === 0) {
      toast.error("El pedido no tiene cantidades");
      return;
    }
    startTransition(async () => {
      const res = await approveOrder({
        supplierId: supplier.id,
        lines: activeLines.map((l) => ({
          odooProductId: l.odooProductId,
          productName: l.name,
          qty: qty[l.odooProductId] ?? 0,
          suggestedQty: l.suggestedQty,
          unitCost: l.unitCost,
          reason: l.reason,
        })),
      });
      if (!res.ok) {
        toast.error(res.error ?? "No se pudo aprobar el pedido");
        return;
      }
      if (res.odooError) {
        toast.warning(`Pedido aprobado, pero Odoo falló: ${res.odooError}. Reintenta desde "Pedidos en curso".`);
      } else if (res.odooOrderName) {
        toast.success(`Pedido aprobado — borrador ${res.odooOrderName} creado en Odoo`);
      } else {
        toast.success("Pedido aprobado");
      }
      router.refresh();
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-primary" />
          <p className="font-semibold">{supplier.name}</p>
          <span className="text-xs text-muted-foreground">
            {activeLines.length} producto{activeLines.length === 1 ? "" : "s"} · {formatCurrency(total)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={approve}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {isPending ? "Aprobando…" : "Aprobar pedido"}
          </button>
          <button
            onClick={() => setDismissed(true)}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Descartar
          </button>
        </div>
      </div>

      <LineTable lines={abLines} qty={qty} setQty={setQty} />

      {cLines.length > 0 && (
        <div className="border-t border-border">
          <button
            onClick={() => setShowC((v) => !v)}
            className="flex w-full items-center gap-1.5 p-3 text-xs text-muted-foreground hover:bg-secondary/50"
          >
            {showC ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Clase C — evalúa si vale la pena ({cLines.length})
          </button>
          {showC && <LineTable lines={cLines} qty={qty} setQty={setQty} />}
        </div>
      )}
    </div>
  );
}

function LineTable({
  lines,
  qty,
  setQty,
}: {
  lines: SuggestionLine[];
  qty: Record<number, number>;
  setQty: Dispatch<SetStateAction<Record<number, number>>>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Producto</th>
            <th className="px-2 py-2 font-medium text-right">Stock</th>
            <th className="px-2 py-2 font-medium text-right">Cobertura</th>
            <th className="px-2 py-2 font-medium text-right">Vende/día</th>
            <th className="px-2 py-2 font-medium text-center">Motivo</th>
            <th className="px-2 py-2 font-medium text-right">Pedir</th>
            <th className="px-4 py-2 font-medium text-right">Costo est.</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const q = qty[l.odooProductId] ?? 0;
            const badge = reasonBadge[l.reason];
            return (
              <tr key={l.odooProductId} className="border-t border-border/60">
                <td className="px-4 py-2">
                  <span className="line-clamp-1">{l.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {l.tier} · {l.category ?? "sin categoría"}
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{Math.round(l.stockQty)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{l.daysOfStock.toFixed(0)}d</td>
                <td className="px-2 py-2 text-right tabular-nums">{l.avgDailySales7d.toFixed(1)}</td>
                <td className="px-2 py-2 text-center">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", badge.cls)}>{badge.label}</span>
                </td>
                <td className="px-2 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    value={q}
                    onChange={(e) =>
                      setQty((prev) => ({ ...prev, [l.odooProductId]: Math.max(0, Number(e.target.value) || 0) }))
                    }
                    className="w-16 rounded-md border border-border bg-background px-2 py-1 text-right text-sm"
                  />
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(q * l.unitCost)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UnassignedCard({
  unassigned,
  suppliers,
}: {
  unassigned: ReplenishmentSuggestion;
  suppliers: SupplierOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");

  const assign = (odooProductId: number, supplierId: string) => {
    if (!supplierId) return;
    startTransition(async () => {
      const res = await assignSupplier(odooProductId, supplierId);
      if (!res.ok) toast.error(res.error ?? "No se pudo asignar");
      else router.refresh();
    });
  };

  const createSupplier = () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      const res = await saveSupplier({ name: newName.trim() });
      if (!res.ok) toast.error(res.error ?? "No se pudo crear el proveedor");
      else {
        toast.success("Proveedor creado — asígnalo a los productos");
        setNewName("");
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-xl border border-dashed border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4 flex-wrap">
        <p className="font-semibold text-muted-foreground">
          Sin proveedor ({unassigned.lines.length}) — asigna una vez y el sistema lo recuerda
        </p>
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nuevo proveedor…"
            className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          />
          <button
            onClick={createSupplier}
            disabled={isPending || !newName.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Crear
          </button>
          <button
            onClick={() =>
              startTransition(async () => {
                const res = await importSuppliersAction();
                if (!res.ok) toast.error(res.error ?? "No se pudo importar");
                else {
                  toast.success(`Proveedores: ${res.created ?? 0} nuevos, ${res.phonesFilled ?? 0} teléfonos completados`);
                  router.refresh();
                }
              })
            }
            disabled={isPending}
            className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
          >
            Importar de Odoo
          </button>
        </div>
      </div>
      <div className="divide-y divide-border/60">
        {unassigned.lines.map((l) => (
          <div key={l.odooProductId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm flex-wrap">
            <div>
              <span className="line-clamp-1">{l.name}</span>
              <span className="text-[10px] text-muted-foreground">
                stock {Math.round(l.stockQty)} · {l.daysOfStock.toFixed(0)}d · sugerido {l.suggestedQty}
              </span>
            </div>
            <select
              defaultValue=""
              disabled={isPending}
              onChange={(e) => assign(l.odooProductId, e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="" disabled>
                Asignar proveedor…
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
