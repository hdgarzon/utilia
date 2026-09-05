/* Compara qty_available antes y despues de una tanda de cambios masivos y
   cuenta los movimientos de stock del dia. Solo lectura contra Odoo.
   Uso: npm run verify:inventario antes  ...aplicar cambios...  npm run verify:inventario despues */
import { odooRpc } from "../src/lib/odoo";
import fs from "node:fs";

const SNAPSHOT = "/tmp/utilia-inventario.json";

(async () => {
  const modo = process.argv[2]; // "antes" | "despues"

  const productos = await odooRpc.searchRead<{ id: number; name: string; qty_available: number }>(
    "product.template",
    [],
    ["id", "name", "qty_available"],
    { limit: 2000, order: "id asc" }
  );
  const mapa = Object.fromEntries(productos.map((p) => [p.id, p.qty_available]));

  const hoy = new Date().toISOString().slice(0, 10);
  const movimientos = await odooRpc.executeKw<number>("stock.move", "search_count", [
    [["date", ">=", `${hoy} 00:00:00`]],
  ]);

  if (modo === "antes") {
    fs.writeFileSync(SNAPSHOT, JSON.stringify({ mapa, movimientos }));
    console.log(`Foto guardada: ${productos.length} productos, ${movimientos} movimientos hoy.`);
    return;
  }

  const previo = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const cambios = productos.filter((p) => previo.mapa[p.id] !== undefined && previo.mapa[p.id] !== p.qty_available);

  console.log(`Movimientos de stock hoy: antes ${previo.movimientos} → ahora ${movimientos}`);
  if (cambios.length === 0) {
    console.log("OK: ninguna cantidad cambio.");
  } else {
    console.log(`FALLO: ${cambios.length} productos cambiaron de cantidad:`);
    cambios.slice(0, 20).forEach((p) => console.log(`   ${p.id} ${p.name}: ${previo.mapa[p.id]} → ${p.qty_available}`));
  }
})();
