/* Compara qty_available antes y despues de una tanda de cambios masivos y
   cuenta los movimientos de stock del dia. Solo lectura contra Odoo.
   Uso: npm run verify:inventario antes  ...aplicar cambios...  npm run verify:inventario despues */
import { odooRpc } from "../src/lib/odoo";
import { colombiaToday } from "../src/lib/timezone";
import fs from "node:fs";

const SNAPSHOT = "/tmp/utilia-inventario.json";
const PAGE_SIZE = 500;
const MAX_PLANTILLAS = 20_000;

interface Fila {
  id: number;
  name: string;
  qty_available: number;
}

/**
 * Lee TODAS las plantillas, archivadas incluidas.
 *
 * Dos trampas que este helper cierra:
 *  - `search_read` filtra `active = true` por defecto. Un producto archivado
 *    entre las dos fotos desapareceria de la segunda y su cambio de cantidad
 *    no se compararia nunca.
 *  - Un `limit` alto corta el catalogo en silencio al superarlo (mismo
 *    paginado que `getProducts` en src/lib/odoo.ts).
 */
async function leerPlantillas(): Promise<Fila[]> {
  const todas: Fila[] = [];
  for (let offset = 0; offset < MAX_PLANTILLAS; offset += PAGE_SIZE) {
    const pagina = await odooRpc.searchRead<Fila>(
      "product.template",
      ["|", ["active", "=", true], ["active", "=", false]],
      ["id", "name", "qty_available"],
      { limit: PAGE_SIZE, offset, order: "id asc" }
    );
    todas.push(...pagina);
    if (pagina.length < PAGE_SIZE) return todas;
  }
  console.warn(`AVISO: se alcanzo el tope de ${MAX_PLANTILLAS} plantillas; la comparacion puede estar incompleta.`);
  return todas;
}

(async () => {
  const modo = process.argv[2];
  if (modo !== "antes" && modo !== "despues") {
    console.error("Uso: npm run verify:inventario antes | despues");
    process.exitCode = 1;
    return;
  }

  const plantillas = await leerPlantillas();
  const mapa: Record<number, number> = {};
  for (const p of plantillas) mapa[p.id] = p.qty_available;

  // Fecha de COLOMBIA, no la de UTC. Despues de las 7pm locales
  // `new Date().toISOString()` ya devuelve el dia siguiente, y las dos fotos
  // medirian ventanas distintas sin avisar (ver src/lib/timezone.ts).
  const hoy = colombiaToday().toISOString().slice(0, 10);
  const movimientos = await odooRpc.executeKw<number>("stock.move", "search_count", [
    [["date", ">=", `${hoy} 00:00:00`]],
  ]);

  if (modo === "antes") {
    fs.writeFileSync(
      SNAPSHOT,
      JSON.stringify({ tomadaEn: new Date().toISOString(), mapa, movimientos })
    );
    console.log(`Foto guardada: ${plantillas.length} plantillas, ${movimientos} movimientos el ${hoy}.`);
    return;
  }

  if (!fs.existsSync(SNAPSHOT)) {
    console.error(`No hay foto previa en ${SNAPSHOT}. Corre primero: npm run verify:inventario antes`);
    process.exitCode = 1;
    return;
  }
  const previo = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")) as {
    tomadaEn?: string;
    mapa: Record<number, number>;
    movimientos: number;
  };

  const cambios = plantillas.filter(
    (p) => previo.mapa[p.id] !== undefined && previo.mapa[p.id] !== p.qty_available
  );
  const comparadas = plantillas.filter((p) => previo.mapa[p.id] !== undefined).length;
  const desaparecidas = Object.keys(previo.mapa).filter((id) => mapa[Number(id)] === undefined);
  const nuevas = plantillas.length - comparadas;
  const movio = movimientos !== previo.movimientos;

  // Se imprime SIEMPRE cuantas se compararon: sin ese numero, un "OK" seria
  // indistinguible de una lectura vacia que no comparo nada.
  console.log(`Foto previa: ${previo.tomadaEn ?? "(sin fecha)"}`);
  console.log(
    `Comparadas: ${comparadas} plantillas (${nuevas} nuevas desde la foto, ${desaparecidas.length} desaparecidas)`
  );
  console.log(`Movimientos de stock el ${hoy}: antes ${previo.movimientos} -> ahora ${movimientos}`);

  if (cambios.length === 0 && !movio && desaparecidas.length === 0) {
    console.log(`OK: ninguna de las ${comparadas} cantidades cambio y no aparecieron movimientos.`);
    return;
  }

  if (cambios.length > 0) {
    console.log(`FALLO: ${cambios.length} plantillas cambiaron de cantidad:`);
    cambios
      .slice(0, 20)
      .forEach((p) => console.log(`   ${p.id} ${p.name}: ${previo.mapa[p.id]} -> ${p.qty_available}`));
  }
  if (movio) {
    console.log(`FALLO: aparecieron ${movimientos - previo.movimientos} movimientos de stock nuevos.`);
  }
  if (desaparecidas.length > 0) {
    console.log(
      `AVISO: ${desaparecidas.length} plantillas de la foto ya no se leen: ${desaparecidas.slice(0, 10).join(", ")}`
    );
  }
  process.exitCode = 1;
})();
