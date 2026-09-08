"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { buildCsv, downloadCsv } from "@/lib/csv";
import {
  parseDelimited,
  guessColumnMapping,
  normalizar,
  leerNumero,
  COLUMNAS_PLANTILLA,
} from "@/lib/products/csv-import";
import {
  filaVacia,
  defaultsDeFila,
  MAX_ROWS_PER_BATCH,
  type ImportRowInput,
} from "@/lib/products/import-types";
import type { CatalogOptions, ProductType } from "@/lib/products/types";

/**
 * Lo que cuenta como "si" en una celda de texto. Compartido con el pegado de
 * la hoja: es el mismo campo y no puede leerse distinto segun por donde entre.
 */
export const TOKENS_VERDADERO: ReadonlySet<string> = new Set([
  "si",
  "x",
  "true",
  "1",
  "yes",
  "verdadero",
]);

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
    // Cuenta las celdas numericas que no se pudieron leer (p. ej. "$ 2.500"
    // mal escrito, o texto donde iba un numero). Antes esto devolvia `null`,
    // indistinguible de una celda vacia, y una columna de precio con formato
    // raro creaba productos a precio 0 sin que nadie lo notara.
    const invalidos = { count: 0 };
    const filas = cuerpo.map((cols, i) => aFila(cols, mapeo, i, options, invalidos));
    onRows(filas);

    const ignoradas = matriz.length - 1 - cuerpo.length;
    const avisoInvalidos =
      invalidos.count === 1
        ? ". 1 celda numérica no se pudo leer y quedó vacía"
        : invalidos.count > 1
          ? `. ${invalidos.count} celdas numéricas no se pudieron leer y quedaron vacías`
          : "";
    toast.success(
      `${filas.length} filas importadas${reconocidas < mapeo.length ? `, ${mapeo.length - reconocidas} columnas sin reconocer` : ""}` +
        (ignoradas > 0 ? `. Se ignoraron ${ignoradas} por el tope de ${MAX_ROWS_PER_BATCH}.` : "") +
        avisoInvalidos
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

/**
 * Convierte una fila cruda del archivo en una fila de la hoja.
 *
 * @param invalidos Contador compartido entre todas las filas del archivo: se
 * incrementa una vez por cada celda numerica que no se pudo leer, para que
 * `importar` avise cuantas quedaron vacias en vez de crear productos a precio
 * 0 en silencio.
 */
function aFila(
  cols: string[],
  mapeo: Array<string | null>,
  rowIndex: number,
  options: CatalogOptions,
  invalidos: { count: number }
): ImportRowInput {
  const fila = filaVacia(rowIndex, defaultsDeFila(options));
  const valor = (key: string): string => {
    const i = mapeo.indexOf(key);
    return i === -1 ? "" : (cols[i] ?? "").trim();
  };
  const numero = (key: string): number | null => {
    const leido = leerNumero(valor(key));
    if (leido === "invalido") {
      invalidos.count++;
      return null;
    }
    return leido;
  };
  const booleano = (key: string): boolean => TOKENS_VERDADERO.has(normalizar(valor(key)));
  /**
   * Una columna que el archivo NO trae conserva el valor por defecto de la
   * fila. Sin esto, `booleano` devuelve false para una celda ausente y una
   * lista sin la columna "Publicado" apagaria el default en silencio: el
   * usuario marco los defaults y el CSV se los quitaria sin decir nada.
   */
  const booleanoODefecto = (key: string, porDefecto: boolean): boolean =>
    valor(key) ? booleano(key) : porDefecto;
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
    // Sin columna de impuesto, o con un nombre que no existe en Odoo, se
    // conserva el que trae la fila por defecto.
    purchaseTaxIds: impuesto !== null ? [impuesto] : fila.purchaseTaxIds,
    categoryId: porNombre(options.categories, "category"),
    imageUrl: valor("imageUrl") || null,
    isPublished: booleanoODefecto("isPublished", fila.isPublished),
    publicCategoryIds: catTienda !== null ? [catTienda] : [],
    showAvailability: booleanoODefecto("showAvailability", fila.showAvailability),
    availableInPos: booleanoODefecto("availableInPos", fila.availableInPos),
    supplierPartnerId: porNombre(options.suppliers, "supplier"),
  };
}
