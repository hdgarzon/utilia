"use client";

import { useState } from "react";
import { CatalogTable } from "./CatalogTable";
import { BulkActionBar } from "./BulkActionBar";
import type { CatalogOptions, CatalogRow } from "@/lib/products/types";

/**
 * Lo minimo que hay que recordar de un producto seleccionado para poder
 * avisar y reportar sin tenerlo en pantalla.
 */
export interface SeleccionItem {
  templateId: number;
  name: string;
  supplierName: string | null;
}

export function CatalogWorkspace({
  rows,
  options,
}: {
  rows: CatalogRow[];
  options: CatalogOptions;
}) {
  // Un Map y no un Set de ids: la seleccion sobrevive al cambio de pagina,
  // pero `rows` solo trae la pagina actual. Contar los que ya tienen
  // proveedor sobre `rows` daria CERO para lo seleccionado en otra pagina, y
  // el aviso de "se pierden los proveedores existentes" —- que es la unica
  // proteccion ante un cambio irreversible -- no se mostraria.
  const [selected, setSelected] = useState<Map<number, SeleccionItem>>(new Map());

  function toggle(row: CatalogRow) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.templateId)) next.delete(row.templateId);
      else next.set(row.templateId, {
        templateId: row.templateId,
        name: row.name,
        supplierName: row.supplierName,
      });
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const todosMarcados = rows.length > 0 && rows.every((r) => prev.has(r.templateId));
      const next = new Map(prev);
      for (const r of rows) {
        if (todosMarcados) next.delete(r.templateId);
        else next.set(r.templateId, {
          templateId: r.templateId,
          name: r.name,
          supplierName: r.supplierName,
        });
      }
      return next;
    });
  }

  return (
    <>
      <CatalogTable rows={rows} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
      <BulkActionBar
        seleccion={[...selected.values()]}
        options={options}
        onDone={() => setSelected(new Map())}
      />
    </>
  );
}
