import { describe, it, expect } from "vitest";
import { parseDelimited, guessColumnMapping, leerNumero, COLUMNAS_PLANTILLA } from "./csv-import";

describe("parseDelimited", () => {
  it("texto vacio no da filas", () => {
    expect(parseDelimited("")).toEqual([]);
    expect(parseDelimited("   \n  ")).toEqual([]);
  });

  it("separa por comas", () => {
    expect(parseDelimited("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("detecta tabulaciones cuando hay mas que comas", () => {
    expect(parseDelimited("a\tb\tc\n1\t2\t3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("una coma dentro de comillas no separa", () => {
    expect(parseDelimited('nombre,precio\n"CUADERNO, GRANDE",1000')).toEqual([
      ["nombre", "precio"],
      ["CUADERNO, GRANDE", "1000"],
    ]);
  });

  it("dos comillas seguidas son una comilla literal", () => {
    expect(parseDelimited('a\n"dice ""hola"""')).toEqual([["a"], ['dice "hola"']]);
  });

  it("un salto de linea dentro de comillas no corta la fila", () => {
    expect(parseDelimited('a,b\n"linea1\nlinea2",x')).toEqual([
      ["a", "b"],
      ["linea1\nlinea2", "x"],
    ]);
  });

  it("acepta finales de linea de Windows", () => {
    expect(parseDelimited("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("recorta el BOM que Excel antepone", () => {
    expect(parseDelimited("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("conserva las celdas vacias para no correr las columnas", () => {
    expect(parseDelimited("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("una comilla sin cerrar falla en vez de tragarse el resto", () => {
    // Sin esto, todo lo que sigue a la comilla huerfana se apilaba en UNA
    // celda y las filas posteriores desaparecian sin aviso. Un nombre como
    // 24" monitor escrito a mano basta para provocarlo.
    expect(() => parseDelimited('a,b\n"sin cerrar,valor\nmas texto')).toThrow(/comilla sin cerrar/i);
  });

  it("una comilla correctamente cerrada no falla", () => {
    expect(parseDelimited('a\n"cerrada"')).toEqual([["a"], ["cerrada"]]);
  });

  it("ignora una linea final vacia", () => {
    expect(parseDelimited("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("un separador explicito ignora la deteccion automatica", () => {
    // Pegar desde una hoja de calculo con una sola columna de nombres es
    // siempre TSV. Sin el separador explicito, detectarSeparador cuenta mas
    // comas que tabs en "Cuaderno, 100 hojas" y parte el nombre en dos celdas.
    expect(parseDelimited("Cuaderno, 100 hojas", "\t")).toEqual([["Cuaderno, 100 hojas"]]);

    // La misma entrada con separador explicito "," en vez de tabs demuestra
    // que el parametro de verdad gana sobre lo que la deteccion automatica
    // habria elegido (aqui elegiria tab, por tener menos comas que tabs).
    expect(parseDelimited("a\tb,c,d", ",")).toEqual([["a\tb", "c", "d"]]);
  });
});

describe("leerNumero", () => {
  it("celda vacia o ausente da null", () => {
    expect(leerNumero("")).toBeNull();
    expect(leerNumero(undefined)).toBeNull();
    expect(leerNumero("   ")).toBeNull();
  });

  it("miles con punto", () => {
    expect(leerNumero("2.500")).toBe(2500);
    expect(leerNumero("12.000")).toBe(12000);
  });

  it("decimales con coma", () => {
    expect(leerNumero("1.500,50")).toBe(1500.5);
  });

  it("simbolo de moneda y espacios se ignoran", () => {
    expect(leerNumero("$ 2.500")).toBe(2500);
  });

  it("un numero simple sin separadores", () => {
    expect(leerNumero("12")).toBe(12);
  });

  it("cero es un numero valido, no una celda vacia", () => {
    expect(leerNumero("0")).toBe(0);
  });

  it("texto que no es un numero es invalido, no vacio", () => {
    // La distincion importa: antes esto devolvia null, indistinguible de una
    // celda vacia, y una columna de precio con texto colado creaba productos
    // a precio 0 sin que nadie lo notara.
    expect(leerNumero("abc")).toBe("invalido");
  });

  it("numeros negativos", () => {
    expect(leerNumero("-3")).toBe(-3);
  });

  it("una celda sin ningun digito es invalida, no vacia ni cero", () => {
    // Los dos casos que se colaban, cada uno por un camino distinto:
    //
    // "$" a secas quedaba en "" al quitar el simbolo y salia como null, o
    // sea como celda vacia: el precio se iba en blanco sin avisar.
    expect(leerNumero("$")).toBe("invalido");
    // ".." o "." pierden los puntos al normalizar los miles, quedan en "",
    // y Number("") es 0: un precio real de cero puesto en Odoo en silencio.
    expect(leerNumero("..")).toBe("invalido");
    expect(leerNumero(".")).toBe("invalido");
    expect(leerNumero(",")).toBe("invalido");
    expect(leerNumero("-")).toBe("invalido");
  });
});

describe("guessColumnMapping", () => {
  it("reconoce los encabezados de la plantilla", () => {
    const headers = COLUMNAS_PLANTILLA.map((c) => c.label);
    expect(guessColumnMapping(headers)).toEqual(COLUMNAS_PLANTILLA.map((c) => c.key));
  });

  it("ignora mayusculas y espacios sobrantes", () => {
    expect(guessColumnMapping(["  NOMBRE  ", "Precio de Venta"])).toEqual(["name", "salePrice"]);
  });

  it("ignora las tildes", () => {
    // Con tildes de verdad: sin este caso, borrar el paso que las quita
    // dejaria pasar la prueba igual.
    expect(guessColumnMapping(["Categoría"])).toEqual(["category"]);
    expect(guessColumnMapping(["CATEGORÍA DE LA TIENDA"])).toEqual(["publicCategory"]);
  });

  it("deja en null lo que no reconoce", () => {
    expect(guessColumnMapping(["nombre", "columna rara"])).toEqual(["name", null]);
  });

  it("no asigna la misma columna dos veces", () => {
    expect(guessColumnMapping(["nombre", "nombre"])).toEqual(["name", null]);
  });
});
