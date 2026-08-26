/**
 * Completa los datos fiscales mínimos de los contactos para facturar a la DIAN.
 *
 * Hace tres cosas:
 *  1. Asigna la responsabilidad R-99-PN ("No aplica") a los contactos que no
 *     tengan ninguna. Es el valor por defecto correcto para quien no es gran
 *     contribuyente, autorretenedor ni agente de retención.
 *  2. Crea el contacto "Consumidor final" para ventas de mostrador.
 *  3. Lista los contactos sin NIT/documento. Esos NO se autocompletan: el
 *     número de identificación se captura a mano o la factura sale mal.
 *
 * Nunca sobrescribe un contacto que ya tenga responsabilidades asignadas.
 *
 *   npm run co:partners              # dry-run
 *   npm run co:partners -- --apply   # escribe
 */
import { chunk, correr, executeKw, parseFlags, searchRead, titulo } from "./co-edi-shared";

const RESPONSABILIDAD_POR_DEFECTO = "R-99-PN";
const CONSUMIDOR_FINAL = {
  name: "Consumidor final",
  vat: "222222222222",
  /** 49 = No aplica, en l10n_co_edi_fiscal_regimen. */
  regimen: "49",
  /** Código del tipo de identificación en l10n_latam.identification.type. */
  tipoDocumento: "national_citizen_id",
};

interface Partner { id: number; name: string; vat: string | false }

async function main(): Promise<number> {
  const flags = parseFlags();
  const raiz: unknown[] = [["active", "=", true], ["parent_id", "=", false]];

  titulo("Responsabilidades fiscales");
  const [responsabilidad] = await searchRead<{ id: number; name: string }>(
    "l10n_co_edi.type_code", [["name", "=", RESPONSABILIDAD_POR_DEFECTO]], ["name"], { limit: 1 },
  );
  if (!responsabilidad) {
    console.error(`  ✗ No existe la responsabilidad ${RESPONSABILIDAD_POR_DEFECTO} en l10n_co_edi.type_code`);
    return 1;
  }
  console.log(`  ✓ ${responsabilidad.name} (id ${responsabilidad.id})`);

  const sinResponsabilidad = await searchRead<Partner>(
    "res.partner", [...raiz, ["l10n_co_edi_obligation_type_ids", "=", false]], ["name", "vat"], { limit: 5000, order: "name asc" },
  );
  console.log(`  · ${sinResponsabilidad.length} contactos sin responsabilidades`);
  if (flags.verbose) for (const p of sinResponsabilidad) console.log(`      ${p.name}`);

  titulo("Contactos sin NIT/documento");
  const sinVat = await searchRead<Partner>("res.partner", [...raiz, ["vat", "=", false]], ["name"], { limit: 5000, order: "name asc" });
  if (sinVat.length === 0) {
    console.log("  ✓ todos los contactos tienen documento");
  } else {
    console.log(`  ! ${sinVat.length} contactos requieren captura manual del documento:`);
    for (const p of sinVat) console.log(`      ${p.name}`);
  }

  titulo("Consumidor final");
  const existente = await searchRead<Partner>("res.partner", [["vat", "=", CONSUMIDOR_FINAL.vat]], ["name"], { limit: 5 });
  const hayQueCrearlo = existente.length === 0;
  if (hayQueCrearlo) console.log(`  · no existe — se creará "${CONSUMIDOR_FINAL.name}" con documento ${CONSUMIDOR_FINAL.vat}`);
  else console.log(`  ✓ ya existe: ${existente.map((p) => p.name).join(", ")}`);

  titulo("Resumen");
  console.log(`  responsabilidad a asignar: ${sinResponsabilidad.length} contactos`);
  console.log(`  consumidor final:          ${hayQueCrearlo ? "crear" : "sin cambios"}`);
  console.log(`  captura manual pendiente:  ${sinVat.length} contactos`);

  if (!flags.apply) {
    console.log("\n  Dry-run. Nada escrito. Repetir con --apply para aplicar.");
    return 0;
  }

  titulo("Escribiendo");
  if (sinResponsabilidad.length > 0) {
    for (const lote of chunk(sinResponsabilidad.map((p) => p.id))) {
      await executeKw("res.partner", "write", [lote, { l10n_co_edi_obligation_type_ids: [[6, 0, [responsabilidad.id]]] }]);
    }
    console.log(`  ✓ ${RESPONSABILIDAD_POR_DEFECTO} asignada a ${sinResponsabilidad.length} contactos`);
  }

  if (hayQueCrearlo) {
    const [tipo] = await searchRead<{ id: number; name: string }>(
      "l10n_latam.identification.type",
      [["l10n_co_document_code", "=", CONSUMIDOR_FINAL.tipoDocumento]],
      ["name"], { limit: 1 },
    );
    if (!tipo) {
      console.error(`  ✗ No existe el tipo de documento "${CONSUMIDOR_FINAL.tipoDocumento}"`);
      return 1;
    }
    const id = await executeKw<number>("res.partner", "create", [{
      name: CONSUMIDOR_FINAL.name,
      vat: CONSUMIDOR_FINAL.vat,
      l10n_latam_identification_type_id: tipo.id,
      l10n_co_edi_fiscal_regimen: CONSUMIDOR_FINAL.regimen,
      l10n_co_edi_obligation_type_ids: [[6, 0, [responsabilidad.id]]],
      customer_rank: 1,
      company_type: "person",
    }]);
    console.log(`  ✓ "${CONSUMIDOR_FINAL.name}" creado (id ${id}, ${tipo.name} ${CONSUMIDOR_FINAL.vat})`);
  }

  if (sinVat.length > 0) console.log(`\n  Quedan ${sinVat.length} contactos sin documento — captura manual.`);
  return 0;
}

correr(main);
