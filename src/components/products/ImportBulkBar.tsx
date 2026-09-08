"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { ImportRowInput } from "@/lib/products/import-types";
import type { CatalogOptions } from "@/lib/products/types";

const CLASE_CONTROL =
  "rounded border border-border bg-background px-1.5 py-1 text-xs max-w-[150px]";

type CampoLista =
  | "categoryId"
  | "publicCategoryIds"
  | "purchaseTaxIds"
  | "supplierPartnerId";

/**
 * Select de un solo uso: aplica al soltarlo y se devuelve a "—".
 *
 * Fuera del componente a proposito. Declarado dentro del render, React lo
 * trata como un componente NUEVO en cada render y le reinicia el estado.
 */
function Lista({
  etiqueta,
  items,
  campo,
  onAplicar,
}: {
  etiqueta: string;
  items: ReadonlyArray<{ id: number; name: string }>;
  campo: CampoLista;
  onAplicar: (cambio: Partial<ImportRowInput>) => void;
}) {
  return (
    <select
      value=""
      aria-label={`${etiqueta} para las filas seleccionadas`}
      className={CLASE_CONTROL}
      onChange={(e) => {
        if (!e.target.value) return;
        const id = Number(e.target.value);
        onAplicar(
          campo === "publicCategoryIds"
            ? { publicCategoryIds: [id] }
            : campo === "purchaseTaxIds"
              ? { purchaseTaxIds: [id] }
              : { [campo]: id }
        );
        e.target.value = "";
      }}
    >
      <option value="">{etiqueta}…</option>
      {items.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/** Si / No explicitos: una casilla no sabria representar filas dispares. */
function Bandera({
  etiqueta,
  campo,
  onAplicar,
}: {
  etiqueta: string;
  campo: "isStorable" | "isPublished" | "showAvailability" | "availableInPos";
  onAplicar: (cambio: Partial<ImportRowInput>) => void;
}) {
  return (
    <select
      value=""
      aria-label={`${etiqueta} para las filas seleccionadas`}
      className={CLASE_CONTROL}
      onChange={(e) => {
        if (!e.target.value) return;
        onAplicar({ [campo]: e.target.value === "si" });
        e.target.value = "";
      }}
    >
      <option value="">{etiqueta}…</option>
      <option value="si">Sí</option>
      <option value="no">No</option>
    </select>
  );
}

/**
 * Barra de edicion en masa de la hoja de carga.
 *
 * Existe por lo que cuesta lo contrario: las cuatro listas de Odoo
 * -- categoria, categoria de tienda, impuesto y proveedor -- no se pueden
 * pegar desde Excel, porque un id de Odoo no se adivina desde un nombre. En
 * una lista de 200 productos del mismo proveedor eso son 200 clics.
 *
 * Cada control aplica al soltarlo y vuelve a "—". No hay boton de confirmar
 * a proposito: el numero de filas afectadas esta a la vista todo el tiempo, y
 * un paso extra en algo que se repite mucho estorba mas de lo que protege.
 * La excepcion son minimo y maximo, que se escriben a mano: aplicar por cada
 * tecla pondria 1 antes de 10.
 */
export function ImportBulkBar({
  cuantas,
  options,
  onAplicar,
  onLimpiar,
}: {
  cuantas: number;
  options: CatalogOptions;
  onAplicar: (cambio: Partial<ImportRowInput>) => void;
  onLimpiar: () => void;
}) {
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");

  return (
    <div className="flex items-center gap-2 flex-wrap rounded-xl border border-primary/40 bg-primary/5 p-2">
      <span className="text-xs font-semibold text-primary whitespace-nowrap">
        {cuantas} fila{cuantas !== 1 ? "s" : ""} seleccionada{cuantas !== 1 ? "s" : ""}
      </span>

      <select
        value=""
        aria-label="Tipo para las filas seleccionadas"
        className={CLASE_CONTROL}
        onChange={(e) => {
          if (!e.target.value) return;
          onAplicar({ productType: e.target.value as ImportRowInput["productType"] });
          e.target.value = "";
        }}
      >
        <option value="">Tipo…</option>
        <option value="consu">Bienes</option>
        <option value="service">Servicio</option>
        <option value="combo">Combo</option>
      </select>

      <Lista etiqueta="Categoría" items={options.categories} campo="categoryId" onAplicar={onAplicar} />
      <Lista
        etiqueta="Cat. tienda"
        items={options.publicCategories}
        campo="publicCategoryIds"
        onAplicar={onAplicar}
      />
      <Lista etiqueta="Impuesto" items={options.purchaseTaxes} campo="purchaseTaxIds" onAplicar={onAplicar} />
      <Lista etiqueta="Proveedor" items={options.suppliers} campo="supplierPartnerId" onAplicar={onAplicar} />

      <Bandera etiqueta="Rastreo" campo="isStorable" onAplicar={onAplicar} />
      <Bandera etiqueta="Publicado" campo="isPublished" onAplicar={onAplicar} />
      <Bandera etiqueta="Disponib." campo="showAvailability" onAplicar={onAplicar} />
      <Bandera etiqueta="PDV" campo="availableInPos" onAplicar={onAplicar} />

      <span className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          value={min}
          onChange={(e) => setMin(e.target.value)}
          placeholder="Mín."
          aria-label="Mínimo para las filas seleccionadas"
          className={`${CLASE_CONTROL} w-16`}
        />
        <input
          type="number"
          min={0}
          value={max}
          onChange={(e) => setMax(e.target.value)}
          placeholder="Máx."
          aria-label="Máximo para las filas seleccionadas"
          className={`${CLASE_CONTROL} w-16`}
        />
        <button
          // Los dos o ninguno: Odoo declara ambos obligatorios en una regla de
          // reabastecimiento, asi que media regla no se puede crear.
          disabled={min.trim() === "" || max.trim() === ""}
          onClick={() => {
            onAplicar({ stockMin: Number(min), stockMax: Number(max) });
            setMin("");
            setMax("");
          }}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-secondary disabled:opacity-40"
        >
          Aplicar
        </button>
      </span>

      <button
        onClick={onLimpiar}
        aria-label="Quitar la selección"
        className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
      >
        <X className="h-3.5 w-3.5" /> Quitar selección
      </button>
    </div>
  );
}
