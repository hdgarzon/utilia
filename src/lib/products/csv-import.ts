/**
 * Parseo de la lista pegada o importada. Sin imports: se prueba sola.
 *
 * Pegar desde Excel o Google Sheets produce TSV; un archivo exportado
 * produce CSV. Se detecta cual mirando la primera linea.
 */

/** Columnas de la plantilla, en el orden en que salen en el CSV de ejemplo. */
export const COLUMNAS_PLANTILLA: ReadonlyArray<{ key: string; label: string }> = [
  { key: "name", label: "Nombre" },
  { key: "productType", label: "Tipo" },
  { key: "isStorable", label: "Rastreo de inventario" },
  { key: "qtyOnHand", label: "Cantidad a la mano" },
  { key: "salePrice", label: "Precio de venta" },
  { key: "cost", label: "Costo" },
  { key: "purchaseTax", label: "Impuesto de compra" },
  { key: "category", label: "Categoria" },
  { key: "imageUrl", label: "Imagen (link)" },
  { key: "isPublished", label: "Publicado" },
  { key: "publicCategory", label: "Categoria de la tienda" },
  { key: "showAvailability", label: "Mostrar disponibilidad" },
  { key: "supplier", label: "Proveedor" },
];

export function parseDelimited(text: string): string[][] {
  const limpio = text.replace(/^﻿/, "");
  if (!limpio.trim()) return [];

  const sep = detectarSeparador(limpio);
  const filas: string[][] = [];
  let celda = "";
  let fila: string[] = [];
  let enComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];

    if (enComillas) {
      if (c === '"') {
        // Dos comillas seguidas son una comilla literal.
        if (limpio[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        celda += c;
      }
      continue;
    }

    if (c === '"') {
      enComillas = true;
    } else if (c === sep) {
      fila.push(celda);
      celda = "";
    } else if (c === "\n") {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else if (c === "\r") {
      // Final de linea de Windows: el \n que sigue cierra la fila.
    } else {
      celda += c;
    }
  }

  // Una comilla que nunca cierra significa entrada malformada. Antes esto se
  // tragaba en silencio todo lo que venia despues -- separadores y saltos de
  // linea incluidos -- dentro de una sola celda, y las filas siguientes
  // desaparecian sin que nadie se enterara. Mejor fallar fuerte: quien llama
  // lo captura y avisa.
  if (enComillas) {
    throw new Error(
      "El texto tiene una comilla sin cerrar. Revisa el archivo: una comilla suelta hace que se pierdan filas."
    );
  }

  // Ultima celda sin salto de linea al final.
  if (celda !== "" || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }

  return filas;
}

/**
 * Empareja los encabezados del archivo con las columnas de la plantilla.
 * Devuelve una entrada por columna del archivo: la clave que le corresponde,
 * o null si no se reconocio. El usuario puede corregir el mapeo en la UI.
 */
export function guessColumnMapping(headers: string[]): Array<string | null> {
  const usadas = new Set<string>();
  return headers.map((h) => {
    const norm = normalizar(h);
    const match = COLUMNAS_PLANTILLA.find(
      (c) => !usadas.has(c.key) && normalizar(c.label) === norm
    );
    if (!match) return null;
    usadas.add(match.key);
    return match.key;
  });
}

/** Cuenta separadores en la primera linea; gana el que mas aparezca. */
function detectarSeparador(texto: string): string {
  const primera = texto.split("\n", 1)[0] ?? "";
  const tabs = (primera.match(/\t/g) ?? []).length;
  const comas = (primera.match(/,/g) ?? []).length;
  return tabs > comas ? "\t" : ",";
}

/** Minusculas, sin tildes, sin espacios de sobra. */
function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}
