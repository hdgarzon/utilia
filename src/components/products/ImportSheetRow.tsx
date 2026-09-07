"use client";

import { useId } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ImageCell } from "./ImageCell";
import type { CellError, ImportRowInput } from "@/lib/products/import-types";
import type { CatalogOptions } from "@/lib/products/types";

const TIPOS: Array<{ value: ImportRowInput["productType"]; label: string }> = [
  { value: "consu", label: "Bienes" },
  { value: "service", label: "Servicio" },
  { value: "combo", label: "Combo" },
];

export function ImportSheetRow({
  row,
  errors,
  options,
  onChange,
  onRemove,
  onPasteRows,
}: {
  row: ImportRowInput;
  errors: CellError[];
  options: CatalogOptions;
  onChange: (cambio: Partial<ImportRowInput>) => void;
  onRemove: () => void;
  /** Pegado multi-celda: la fila sabe cual es su indice, la hoja no. */
  onPasteRows: (e: React.ClipboardEvent) => void;
}) {
  const uid = useId();
  const problema = (campo: keyof ImportRowInput) => errors.find((e) => e.field === campo);

  // El color solo no basta: quien navega con teclado o lector de pantalla no
  // ve un borde rojo, y `title` casi nunca se anuncia al enfocar. Cada celda
  // con problema se marca invalida y apunta a su mensaje.
  const idError = (campo: keyof ImportRowInput) => `${uid}-${String(campo)}`;
  const ariaCelda = (campo: keyof ImportRowInput) =>
    problema(campo) ? { "aria-invalid": true, "aria-describedby": idError(campo) } : {};

  const claseCelda = (campo: keyof ImportRowInput) => {
    const p = problema(campo);
    return cn(
      "w-full rounded border bg-background px-1.5 py-1 text-xs",
      p?.level === "error"
        ? "border-destructive"
        : p?.level === "warning"
          ? "border-warning"
          : "border-border"
    );
  };
  const numero = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <tr className="border-b border-border last:border-0 align-top" onPasteCapture={onPasteRows}>
      <td className="p-1">
        <input
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value })}
          title={problema("name")?.message}
          aria-label="Nombre del producto"
          {...ariaCelda("name")}
          className={claseCelda("name")}
        />
      </td>
      <td className="p-1">
        <select
          value={row.productType}
          onChange={(e) => {
            const productType = e.target.value as ImportRowInput["productType"];
            // Odoo solo admite rastreo en bienes: al cambiar de tipo se apaga
            // solo, para que el usuario no quede con una celda en rojo que no
            // pidio.
            const esBien = productType === "consu";
            onChange({
              productType,
              isStorable: esBien ? row.isStorable : false,
              qtyOnHand: esBien ? row.qtyOnHand : null,
            });
          }}
          aria-label="Tipo de producto"
          {...ariaCelda("productType")}
          className={claseCelda("productType")}
        >
          {TIPOS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </td>
      <td className="p-1 text-center">
        <input
          type="checkbox"
          checked={row.isStorable}
          disabled={row.productType !== "consu"}
          onChange={(e) => onChange({ isStorable: e.target.checked })}
          title={problema("isStorable")?.message}
          aria-label="Rastreo de inventario"
          {...ariaCelda("isStorable")}
          className="h-3.5 w-3.5 accent-primary disabled:opacity-40"
        />
      </td>
      <td className="p-1">
        <input
          type="number"
          value={row.qtyOnHand ?? ""}
          disabled={row.productType !== "consu"}
          onChange={(e) => onChange({ qtyOnHand: numero(e.target.value) })}
          title={problema("qtyOnHand")?.message}
          aria-label="Cantidad a la mano"
          {...ariaCelda("qtyOnHand")}
          className={claseCelda("qtyOnHand")}
        />
      </td>
      <td className="p-1">
        <input
          type="number"
          value={row.salePrice ?? ""}
          onChange={(e) => onChange({ salePrice: numero(e.target.value) })}
          title={problema("salePrice")?.message}
          aria-label="Precio de venta"
          {...ariaCelda("salePrice")}
          className={claseCelda("salePrice")}
        />
      </td>
      <td className="p-1">
        <input
          type="number"
          value={row.cost ?? ""}
          onChange={(e) => onChange({ cost: numero(e.target.value) })}
          title={problema("cost")?.message}
          aria-label="Costo"
          {...ariaCelda("cost")}
          className={claseCelda("cost")}
        />
      </td>
      <td className="p-1">
        <select
          value={row.purchaseTaxIds[0] ?? ""}
          onChange={(e) => onChange({ purchaseTaxIds: e.target.value ? [Number(e.target.value)] : [] })}
          aria-label="Impuesto de compra"
          {...ariaCelda("purchaseTaxIds")}
          className={claseCelda("purchaseTaxIds")}
        >
          <option value="">—</option>
          {options.purchaseTaxes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </td>
      <td className="p-1">
        <select
          value={row.categoryId ?? ""}
          onChange={(e) => onChange({ categoryId: e.target.value ? Number(e.target.value) : null })}
          aria-label="Categoría interna"
          {...ariaCelda("categoryId")}
          className={claseCelda("categoryId")}
        >
          <option value="">—</option>
          {options.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </td>
      <td className="p-1">
        <ImageCell
          imageUrl={row.imageUrl}
          imageData={row.imageData}
          error={problema("imageUrl")}
          ariaProps={ariaCelda("imageUrl")}
          onChange={(cambio) => onChange(cambio)}
        />
      </td>
      <td className="p-1 text-center">
        <input
          type="checkbox"
          checked={row.isPublished}
          onChange={(e) => onChange({ isPublished: e.target.checked })}
          aria-label="Publicado en la tienda"
          className="h-3.5 w-3.5 accent-primary"
        />
      </td>
      <td className="p-1">
        <select
          value={row.publicCategoryIds[0] ?? ""}
          onChange={(e) => onChange({ publicCategoryIds: e.target.value ? [Number(e.target.value)] : [] })}
          title={problema("publicCategoryIds")?.message}
          aria-label="Categoría de la tienda"
          {...ariaCelda("publicCategoryIds")}
          className={claseCelda("publicCategoryIds")}
        >
          <option value="">—</option>
          {options.publicCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </td>
      <td className="p-1 text-center">
        <input
          type="checkbox"
          checked={row.showAvailability}
          onChange={(e) => onChange({ showAvailability: e.target.checked })}
          aria-label="Mostrar las cantidades disponibles"
          className="h-3.5 w-3.5 accent-primary"
        />
      </td>
      <td className="p-1">
        <select
          value={row.supplierPartnerId ?? ""}
          onChange={(e) => onChange({ supplierPartnerId: e.target.value ? Number(e.target.value) : null })}
          aria-label="Proveedor"
          {...ariaCelda("supplierPartnerId")}
          className={claseCelda("supplierPartnerId")}
        >
          <option value="">—</option>
          {options.suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </td>
      <td className="p-1">
        <button onClick={onRemove} aria-label="Quitar la fila" className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        {/* Los mensajes para lector de pantalla van juntos aqui, no bajo cada
            celda: la tabla ya es densa y meterlos en linea la romperia. Cada
            control los alcanza por aria-describedby. */}
        {errors.map((e) => (
          <span key={String(e.field)} id={idError(e.field)} className="sr-only">
            {e.message}
          </span>
        ))}
      </td>
    </tr>
  );
}
