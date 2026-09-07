"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";
import { ImportSheetRow } from "./ImportSheetRow";
import { ImportToolbar, TOKENS_VERDADERO } from "./ImportToolbar";
import { validateRow, rowIsCreatable } from "@/lib/products/import-schema";
import { parseDelimited, normalizar } from "@/lib/products/csv-import";
import { saveBatch } from "@/app/(dashboard)/productos/cargar/actions";
import { filaVacia, MAX_ROWS_PER_BATCH, type ImportRowInput } from "@/lib/products/import-types";
import type { CatalogOptions } from "@/lib/products/types";

const ENCABEZADOS = [
  "Nombre", "Tipo", "Rastreo", "Cantidad", "Precio", "Costo", "Impuesto",
  "Categoría", "Imagen", "Publicado", "Cat. tienda", "Disponibilidad", "Proveedor", "",
];

export function ImportSheet({ options }: { options: CatalogOptions }) {
  const [nombre, setNombre] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [filas, setFilas] = useState<ImportRowInput[]>([filaVacia(0)]);
  const [guardando, setGuardando] = useState(false);

  const errores = useMemo(
    () => filas.map((f) => validateRow(f, options)),
    [filas, options]
  );
  const conError = errores.filter((e) => !rowIsCreatable(e)).length;

  function cambiar(i: number, cambio: Partial<ImportRowInput>) {
    setFilas((prev) => prev.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  }

  function quitar(i: number) {
    setFilas((prev) => prev.filter((_, j) => j !== i).map((f, j) => ({ ...f, rowIndex: j })));
  }


  function agregar() {
    setFilas((prev) =>
      prev.length >= MAX_ROWS_PER_BATCH ? prev : [...prev, filaVacia(prev.length)]
    );
  }

  /**
   * Pegar desde Excel: si el portapapeles trae varias celdas, se reparte a
   * partir de la fila donde se pego, creando filas si hacen falta.
   *
   * El reparto es POSICIONAL, en el orden de la plantilla (nombre, tipo,
   * rastreo, cantidad, precio, costo, ...). Solo se rellenan las columnas de
   * texto y numero: un id de Odoo no se puede adivinar desde un nombre
   * pegado, asi que categoria, impuesto y proveedor se quedan como estan.
   * Para una lista con las columnas en otro orden esta "Importar CSV", que
   * empareja por encabezado.
   */
  function pegar(e: React.ClipboardEvent, desdeFila: number) {
    const texto = e.clipboardData.getData("text/plain");
    if (!texto.includes("\t") && !texto.includes("\n")) return; // una sola celda: comportamiento normal

    let matriz: string[][];
    try {
      matriz = parseDelimited(texto);
    } catch {
      // Comilla sin cerrar: no es un pegado multi-celda valido. Se deja que
      // el navegador pegue el texto tal cual en la celda, que es lo que el
      // usuario espera si lo que copio no era una tabla.
      return;
    }
    e.preventDefault();
    setFilas((prev) => {
      const next = [...prev];
      matriz.forEach((cols, k) => {
        const i = desdeFila + k;
        if (i >= MAX_ROWS_PER_BATCH) return;
        if (!next[i]) next[i] = filaVacia(i);
        const num = (v: string | undefined) => (v && v.trim() !== "" ? Number(v) : null);
        const txt = (v: string | undefined) => normalizar(v ?? "");

        // Tipo y rastreo llegan como texto libre desde la hoja de calculo.
        // Si la celda viene vacia se conserva lo que ya tenia la fila.
        const tipoPegado = txt(cols[1]);
        const productType: ImportRowInput["productType"] =
          tipoPegado === "servicio" || tipoPegado === "service"
            ? "service"
            : tipoPegado === "combo"
              ? "combo"
              : tipoPegado === "bienes" || tipoPegado === "consu"
                ? "consu"
                : next[i].productType;

        // Odoo solo admite rastreo en bienes: un servicio pegado apaga el
        // rastreo y la cantidad, igual que hace el selector de la fila.
        const esBien = productType === "consu";
        const rastreoPegado = txt(cols[2]);
        const isStorable = !esBien
          ? false
          : rastreoPegado
            ? TOKENS_VERDADERO.has(rastreoPegado)
            : next[i].isStorable;

        next[i] = {
          ...next[i],
          name: cols[0] ?? next[i].name,
          productType,
          isStorable,
          qtyOnHand: esBien ? (num(cols[3]) ?? next[i].qtyOnHand) : null,
          salePrice: num(cols[4]) ?? next[i].salePrice,
          cost: num(cols[5]) ?? next[i].cost,
        };
      });
      return next.map((f, j) => ({ ...f, rowIndex: j }));
    });
  }

  async function guardar() {
    if (!nombre.trim()) {
      toast.error("Ponle un nombre al lote para poder guardarlo");
      return;
    }
    setGuardando(true);
    try {
      const res = await saveBatch({ batchId, name: nombre, rows: filas });
      if (!res.ok) {
        toast.error(res.error ?? "No se pudo guardar");
        return;
      }
      setBatchId(res.batchId ?? null);
      toast.success("Borrador guardado");
    } catch (err) {
      console.error("[cargar] la accion de guardar no llego al servidor:", err);
      toast.error("No se pudo contactar al servidor. Revisa la conexión.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <ImportToolbar
        options={options}
        onRows={(nuevas) => {
          // Importar reemplaza la hoja entera. Si el usuario ya escribio algo
          // y no lo ha guardado, se lo llevaria por delante sin aviso -- y el
          // codigo no puede distinguir "reimporto el archivo corregido" de
          // "acabo de teclear veinte filas".
          const hayTrabajo = filas.some((f) => f.name.trim() !== "");
          if (
            hayTrabajo &&
            !window.confirm("Importar reemplaza todas las filas de la hoja. ¿Continuar?")
          ) {
            return;
          }
          setFilas(nuevas.length > 0 ? nuevas : [filaVacia(0)]);
        }}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del lote (ej: Lista Distribuidora — septiembre)"
          aria-label="Nombre del lote"
          className="flex-1 min-w-[240px] rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
        />
        <button
          onClick={guardar}
          disabled={guardando}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" /> {guardando ? "Guardando…" : "Guardar borrador"}
        </button>
        <span className="text-xs text-muted-foreground">
          {filas.length} fila{filas.length !== 1 ? "s" : ""}
          {conError > 0 ? ` · ${conError} con error` : ""}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              {ENCABEZADOS.map((h, i) => (
                <th key={i} className="py-2 px-1 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <ImportSheetRow
                key={f.clientId}
                row={f}
                errors={errores[i]}
                options={options}
                onChange={(cambio) => cambiar(i, cambio)}
                onRemove={() => quitar(i)}
                onPasteRows={(e) => pegar(e, i)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Puedes pegar varias filas desde Excel o Google Sheets sobre cualquier celda. Se reparten en el orden de
        la plantilla: nombre, tipo, rastreo, cantidad, precio, costo. Si tu lista trae las columnas en otro
        orden, usa “Importar CSV”, que las empareja por el encabezado.
      </p>

      <button
        onClick={agregar}
        disabled={filas.length >= MAX_ROWS_PER_BATCH}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" /> Agregar fila
      </button>
    </div>
  );
}
