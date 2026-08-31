/**
 * Asigna códigos UNSPSC a las plantillas de producto vendibles, por categoría.
 *
 * La DIAN exige un código de clasificación por línea de factura. Hay ~1.500
 * plantillas y 12 categorías, así que el mapeo se decide por categoría.
 *
 * Los códigos de MAPEO están verificados contra el catálogo cargado en Odoo
 * (`product.unspsc.code`, 54.564 registros). El script comprueba que cada uno
 * exista y que su nombre coincida antes de escribir nada: si el catálogo cambió,
 * aborta en vez de asignar un código equivocado.
 *
 * Nunca sobrescribe una plantilla que ya tenga código.
 *
 *   npm run co:unspsc              # dry-run, muestra el plan
 *   npm run co:unspsc -- --apply   # escribe
 */
import { chunk, correr, executeKw, parseFlags, searchRead, titulo } from "./co-edi-shared";

/** Categoría de Odoo → código UNSPSC. `nombre` es el del catálogo, se valida. */
const MAPEO: Record<string, { code: string; nombre: string }> = {
  "PAPELERÍA": { code: "44120000", nombre: "Office supplies" },
  "PIÑATERÍA": { code: "60140000", nombre: "Toys and games" },
  // Categoría heterogénea (plásticos, utensilios, aseo). Es la que más conviene
  // refinar a mano más adelante si la DIAN objeta alguna línea.
  "CACHARRERÍA": { code: "52150000", nombre: "Domestic kitchenware and kitchen supplies" },
  "COSMÉTICOS": { code: "53131619", nombre: "Cosmetics" },
  "CUIDADO PERSONAL": { code: "53130000", nombre: "Personal care products" },
  "JUGUETERÍA": { code: "60140000", nombre: "Toys and games" },
  "TECNOLOGÍA": { code: "43210000", nombre: "Computer Equipment and Accessories" },
  "CONFITERÍA": { code: "50160000", nombre: "Chocolate and sugars and sweeteners and confectionary products" },
  "SERVICIOS": { code: "80160000", nombre: "Business administration services" },
  "JOYERÍA Y ACCESORIOS": { code: "54100000", nombre: "Jewelry" },
};

interface Categoria { id: number; name: string }
interface CodigoUnspsc { id: number; code: string; name: string }

async function main(): Promise<number> {
  const flags = parseFlags();

  titulo("Validación de códigos UNSPSC contra el catálogo");
  const codigos = [...new Set(Object.values(MAPEO).map((m) => m.code))];
  const enCatalogo = await searchRead<CodigoUnspsc>("product.unspsc.code", [["code", "in", codigos]], ["code", "name"], { limit: 100 });
  const porCodigo = new Map(enCatalogo.map((c) => [c.code, c]));

  let invalido = false;
  for (const [categoria, { code, nombre }] of Object.entries(MAPEO)) {
    const encontrado = porCodigo.get(code);
    if (!encontrado) {
      console.log(`  ✗ ${code} no existe en el catálogo (mapeado desde "${categoria}")`);
      invalido = true;
    } else if (encontrado.name.trim() !== nombre) {
      console.log(`  ✗ ${code} se llama "${encontrado.name.trim()}", se esperaba "${nombre}"`);
      invalido = true;
    } else {
      console.log(`  ✓ ${code}  ${encontrado.name}`);
    }
  }
  if (invalido) {
    console.error("\nEl catálogo no coincide con MAPEO. Revisar antes de escribir.");
    return 1;
  }

  titulo("Plan por categoría");
  const categorias = await searchRead<Categoria>("product.category", [], ["name"], { limit: 500 });
  const idPorNombre = new Map(categorias.map((c) => [c.name, c.id]));

  const pendientes = await searchRead<{ id: number; categ_id: [number, string] | false }>(
    "product.template",
    [["active", "=", true], ["sale_ok", "=", true], ["unspsc_code_id", "=", false]],
    ["categ_id"],
    { limit: 20000, order: "id asc" },
  );

  const porCategoriaId = new Map<number, number[]>();
  const huerfanas: number[] = [];
  for (const p of pendientes) {
    if (!p.categ_id) { huerfanas.push(p.id); continue; }
    const lista = porCategoriaId.get(p.categ_id[0]) ?? [];
    lista.push(p.id);
    porCategoriaId.set(p.categ_id[0], lista);
  }

  const escrituras: Array<{ categoria: string; codigoId: number; code: string; ids: number[] }> = [];
  let sinMapear = 0;

  for (const [categoria, { code }] of Object.entries(MAPEO)) {
    const categId = idPorNombre.get(categoria);
    if (categId === undefined) {
      console.log(`  · "${categoria}": la categoría no existe en Odoo — se ignora`);
      continue;
    }
    const ids = porCategoriaId.get(categId) ?? [];
    porCategoriaId.delete(categId);
    if (ids.length === 0) {
      console.log(`  · ${categoria}: nada pendiente`);
      continue;
    }
    console.log(`  · ${categoria}: ${ids.length} plantillas → ${code} (${porCodigo.get(code)!.name})`);
    escrituras.push({ categoria, codigoId: porCodigo.get(code)!.id, code, ids });
  }

  for (const [categId, ids] of porCategoriaId) {
    const nombre = categorias.find((c) => c.id === categId)?.name ?? `id ${categId}`;
    console.log(`  ! ${nombre}: ${ids.length} plantillas sin mapeo — decisión manual`);
    sinMapear += ids.length;
  }
  if (huerfanas.length > 0) {
    console.log(`  ! sin categoría: ${huerfanas.length} plantillas — decisión manual`);
    sinMapear += huerfanas.length;
  }

  const aEscribir = escrituras.reduce((n, e) => n + e.ids.length, 0);
  titulo("Resumen");
  console.log(`  pendientes:        ${pendientes.length}`);
  console.log(`  cubiertas:         ${aEscribir}`);
  console.log(`  decisión manual:   ${sinMapear}`);

  if (!flags.apply) {
    console.log("\n  Dry-run. Nada escrito. Repetir con --apply para aplicar.");
    return 0;
  }
  if (aEscribir === 0) {
    console.log("\n  Nada que escribir.");
    return 0;
  }

  titulo("Escribiendo");
  for (const e of escrituras) {
    for (const lote of chunk(e.ids)) {
      await executeKw("product.template", "write", [lote, { unspsc_code_id: e.codigoId }]);
    }
    console.log(`  ✓ ${e.categoria}: ${e.ids.length} plantillas → ${e.code}`);
  }

  const restantes = await executeKw<number>("product.template", "search_count", [
    [["active", "=", true], ["sale_ok", "=", true], ["unspsc_code_id", "=", false]],
  ]);
  console.log(`\n  Quedan ${restantes} plantillas sin código (las de decisión manual).`);
  return 0;
}

correr(main);
