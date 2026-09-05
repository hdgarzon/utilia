"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { applyBulkChange } from "@/app/(dashboard)/productos/actions";
import { BulkActionDialog, BULK_LABEL, type BulkField } from "./BulkActionDialog";
import type { CatalogOptions, CatalogRow } from "@/lib/products/types";

const CAMPOS: BulkField[] = ["categoria", "categoriaWeb", "publicar", "impuesto", "proveedor"];

export function BulkActionBar({
  selectedIds,
  rows,
  options,
  onDone,
}: {
  selectedIds: number[];
  rows: CatalogRow[];
  options: CatalogOptions;
  onDone: () => void;
}) {
  const router = useRouter();
  const [field, setField] = useState<BulkField | null>(null);
  const [value, setValue] = useState("");
  // `submitting` cubre la escritura misma; `pending` solo cubre el refresh.
  // Sin el primero, un doble clic en "Aplicar" dispararia DOS escrituras
  // masivas contra Odoo de produccion antes de que la primera termine.
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition] = useTransition();

  if (selectedIds.length === 0) return null;

  const seleccion = new Set(selectedIds);
  const conProveedor = rows.filter((r) => seleccion.has(r.templateId) && r.supplierName).length;

  function abrir(f: BulkField) {
    setField(f);
    setValue("");
  }

  async function confirmar() {
    if (!field || !value || submitting) return;
    const n = Number(value);

    const patch =
      field === "categoria"
        ? { categoryId: n }
        : field === "categoriaWeb"
          ? { publicCategoryIds: [n] }
          : field === "impuesto"
            ? { purchaseTaxIds: [n] }
            : field === "proveedor"
              ? { supplierPartnerId: n }
              : { isPublished: value === "1" };

    setSubmitting(true);
    let res;
    try {
      res = await applyBulkChange({ ids: selectedIds, ...patch });
    } finally {
      setSubmitting(false);
    }

    if (!res.ok) {
      toast.error(res.error ?? "No se pudo aplicar el cambio");
      return;
    }

    const fallidos = res.failed ?? [];
    if (fallidos.length === 0) {
      toast.success(`${res.okCount} producto${res.okCount === 1 ? "" : "s"} actualizado${res.okCount === 1 ? "" : "s"}`);
    } else {
      toast.warning(
        `${res.okCount} aplicados, ${fallidos.length} fallaron: ${fallidos
          .slice(0, 3)
          .map((f) => `#${f.id} ${f.error}`)
          .join(" · ")}${fallidos.length > 3 ? "…" : ""}`,
        { duration: 10_000 }
      );
    }

    setField(null);
    onDone();
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="sticky bottom-4 z-40 mx-auto flex w-fit items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lg flex-wrap justify-center">
        <span className="text-xs font-medium whitespace-nowrap">
          {selectedIds.length} seleccionado{selectedIds.length !== 1 ? "s" : ""}
        </span>
        <span className="h-4 w-px bg-border" />
        {CAMPOS.map((f) => (
          <button
            key={f}
            onClick={() => abrir(f)}
            className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-secondary whitespace-nowrap"
          >
            {BULK_LABEL[f]}
          </button>
        ))}
        <button onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground px-1">
          Limpiar
        </button>
      </div>

      {field && (
        <BulkActionDialog
          field={field}
          count={selectedIds.length}
          conProveedor={conProveedor}
          options={options}
          value={value}
          onValueChange={setValue}
          onCancel={() => setField(null)}
          onConfirm={confirmar}
          pending={submitting || pending}
        />
      )}
    </>
  );
}
