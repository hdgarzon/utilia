"use client";

import { useState } from "react";
import { CatalogTable } from "./CatalogTable";
import { BulkActionBar } from "./BulkActionBar";
import type { CatalogOptions, CatalogRow } from "@/lib/products/types";

export function CatalogWorkspace({
  rows,
  options,
}: {
  rows: CatalogRow[];
  options: CatalogOptions;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const todosMarcados = rows.length > 0 && rows.every((r) => prev.has(r.templateId));
      const next = new Set(prev);
      for (const r of rows) {
        if (todosMarcados) next.delete(r.templateId);
        else next.add(r.templateId);
      }
      return next;
    });
  }

  return (
    <>
      <CatalogTable rows={rows} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
      <BulkActionBar
        selectedIds={[...selected]}
        rows={rows}
        options={options}
        onDone={() => setSelected(new Set())}
      />
    </>
  );
}
