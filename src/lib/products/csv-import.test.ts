import { describe, it, expect } from "vitest";
import { parseDelimited, guessColumnMapping, COLUMNAS_PLANTILLA } from "./csv-import";

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
