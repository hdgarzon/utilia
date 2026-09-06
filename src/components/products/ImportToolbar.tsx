"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { parseDelimited, guessColumnMapping, COLUMNAS_PLANTILLA } from "@/lib/products/csv-import";
import { filaVacia, MAX_ROWS_PER_BATCH, type ImportRowInput } from "@/lib/products/import-types";
import type { CatalogOptions, ProductType } from "@/lib/products/types";

export function ImportToolbar({
  options,
  onRows,
}: {
  options: CatalogOptions;
  onRows: (filas: ImportRowInput[]) => void;
}) {
  const inputArchivo = useRef<HTMLInputElement>(null);

  function descargarPlantilla() {
    const csv = buildCsv(
      [],
      COLUMNAS_PLANTILLA.map((c) => ({ header: c.label, value: () => "" }))
    );
    downloadCsv("plantilla-productos.csv", csv);
  }

  async function importar(file: File | undefined) {
    if (!file) return;
    const texto = await file.text();
    let matriz: string[][];
    try {
      matriz = parseDelimited(texto);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo leer el archivo");
      return;
    }
    if (matriz.length < 2) {
      toast.error("El archivo no trae filas debajo del encabezado");
      return;
    }

    const mapeo = guessColumnMapping(matriz[0]);
    const reconocidas = mapeo.filter(Boolean).length;
    if (reconocidas === 0) {
      toast.error("No se reconoció ninguna columna. Descarga la plantilla y usa sus encabezados.");
      return;
    }

    const cuerpo = matriz.slice(1, MAX_ROWS_PER_BATCH + 1);
    const filas = cuerpo.map((cols, i) => aFila(cols, mapeo, i, options));
    onRows(filas);

    const ignoradas = matriz.length - 1 - cuerpo.length;
    toast.success(
      `${filas.length} filas importadas${reconocidas < mapeo.length ? `, ${mapeo.length - reconocidas} columnas sin reconocer` : ""}` +
        (ignoradas > 0 ? `. Se ignoraron ${ignoradas} por el tope de ${MAX_ROWS_PER_BATCH}.` : "")
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => inputArchivo.current?.click()}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"
      >
        <Upload className="h-3.5 w-3.5" /> Importar CSV
      </button>
      <button
        onClick={descargarPlantilla}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"
      >
        <Download className="h-3.5 w-3.5" /> Descargar plantilla
      </button>
      <input
        ref={inputArchivo}
        type="file"
        accept=".csv,.tsv,.txt,text/csv"
        hidden
        onChange={(e) => {
          importar(e.target.files?.[0]);
          // Permite volver a elegir el mismo archivo tras corregirlo.
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Convierte una fila cruda del archivo en una fila de la hoja. */
function aFila(
  cols: string[],
  mapeo: Array<string | null>,
  rowIndex: number,
  options: CatalogOptions
): ImportRowInput {
  const fila = filaVacia(rowIndex);
  const valor = (key: string): string => {
    const i = mapeo.indexOf(key);
    return i === -1 ? "" : (cols[i] ?? "").trim();
  };
  const numero = (key: string): number | null => {
    const v = valor(key);
    if (!v) return null;
    // Los miles con punto y los decimales con coma son lo normal en Colombia.
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  const booleano = (key: string): boolean => {
    const v = normalizar(valor(key));
    return v === "si" || v === "x" || v === "true" || v === "1";
  };
  const porNombre = (lista: Array<{ id: number; name: string }>, key: string): number | null => {
    const v = normalizar(valor(key));
    if (!v) return null;
    return lista.find((o) => normalizar(o.name) === v)?.id ?? null;
  };

  const tipoTexto = normalizar(valor("productType"));
  const productType: ProductType =
    tipoTexto === "servicio" || tipoTexto === "service"
      ? "service"
      : tipoTexto === "combo"
        ? "combo"
        : "consu";
  const esBien = productType === "consu";

  const impuesto = porNombre(options.purchaseTaxes, "purchaseTax");
  const catTienda = porNombre(options.publicCategories, "publicCategory");

  return {
    ...fila,
    name: valor("name") || fila.name,
    productType,
    isStorable: esBien ? (valor("isStorable") ? booleano("isStorable") : true) : false,
    qtyOnHand: esBien ? numero("qtyOnHand") : null,
    salePrice: numero("salePrice"),
    cost: numero("cost"),
    purchaseTaxIds: impuesto !== null ? [impuesto] : [],
    categoryId: porNombre(options.categories, "category"),
    imageUrl: valor("imageUrl") || null,
    isPublished: booleano("isPublished"),
    publicCategoryIds: catTienda !== null ? [catTienda] : [],
    showAvailability: booleano("showAvailability"),
    supplierPartnerId: porNombre(options.suppliers, "supplier"),
  };
}

function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}
