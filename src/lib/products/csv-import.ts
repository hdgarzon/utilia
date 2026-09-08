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
  { key: "availableInPos", label: "Punto de venta" },
  { key: "supplier", label: "Proveedor" },
  // Al FINAL a proposito. El pegado desde Excel es POSICIONAL en este orden,
  // y la gente ya viene pegando hojas con las seis primeras columnas: meter
  // dos columnas en medio le correria el precio y el costo dos puestos, en
  // silencio y sobre productos reales.
  { key: "stockMin", label: "Minimo" },
  { key: "stockMax", label: "Maximo" },
];

/**
 * @param separador Si se pasa, se usa tal cual y no se intenta adivinar.
 * Pegar desde una hoja de calculo SIEMPRE es TSV, incluso si el usuario solo
 * copio una columna de nombres con una coma adentro (p. ej.
 * "Cuaderno, 100 hojas"): sin este parametro, `detectarSeparador` cuenta esa
 * coma, la confunde con el separador, y parte el nombre en dos celdas.
 */
export function parseDelimited(text: string, separador?: string): string[][] {
  const limpio = text.replace(/^﻿/, "");
  if (!limpio.trim()) return [];

  const sep = separador ?? detectarSeparador(limpio);
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
 * o null si no se reconocio. Las columnas en null quedan sin importar: no hay
 * pantalla para corregir el mapeo a mano.
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

/**
 * Minusculas, sin tildes, sin espacios de sobra.
 *
 * Se exporta a proposito: la hoja y la barra de importacion necesitan
 * exactamente la misma normalizacion, y tenerla escrita tres veces fue como
 * el rango de tildes acabo escrito de dos formas distintas.
 */
export function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Lee un numero escrito como lo escribe la gente aqui: miles con punto y
 * decimales con coma ("2.500", "1.500,50"). Devuelve `null` para una celda
 * vacia y `"invalido"` para algo que no es un numero -- son casos distintos y
 * confundirlos fue como una columna con formato de moneda creaba productos a
 * precio 0 sin que nadie lo notara.
 *
 * Compartido por el pegado de la hoja y la importacion de CSV: antes cada uno
 * traia su propio parseo y "2.500" salia 2.5 en uno y 2500 en el otro.
 */
export type NumeroLeido = number | null | "invalido";

export function leerNumero(v: string | undefined): NumeroLeido {
  const s = (v ?? "").trim();
  // Celda vacia: no es un error, es que no dijeron nada.
  if (s === "") return null;
  // Se quitan simbolos de moneda y espacios antes de decidir.
  const limpio = s.replace(/[$\s]/g, "");

  // Escribieron algo que no lleva ni un digito. Hay que exigirlo ANTES de
  // convertir, porque los dos caminos de abajo mienten:
  //   - devolver null (lo que hacia un "$" solo) lo hace pasar por celda
  //     vacia y el precio se va en blanco sin que nadie avise;
  //   - la conversion borra los puntos de los miles, asi que ".." queda en
  //     "" y Number("") es 0 -- un precio real de cero puesto en Odoo en
  //     silencio, que es justo lo que este parseo existe para evitar.
  if (!/\d/.test(limpio)) return "invalido";

  const n = Number(limpio.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : "invalido";
}
