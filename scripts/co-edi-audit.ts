/**
 * Semáforo de la configuración de facturación electrónica (Colombia / DIAN directo).
 *
 * Solo lee. Correr antes y después de cada paso del runbook
 * (docs/FACTURACION_ELECTRONICA_CO_ODOO.md). Sale con código 1 si hay bloqueantes.
 *
 *   npm run co:audit
 *   npm run co:audit -- --verbose
 */
import { Hallazgos, correr, executeKw, parseFlags, searchRead, titulo } from "./co-edi-shared";

const MODULOS_REQUERIDOS = ["l10n_co", "l10n_co_dian", "certificate", "product_unspsc"];
/** Un certificado vencido detiene la facturación por completo. */
const DIAS_AVISO_VENCIMIENTO = 60;
/** A partir de aquí hay que solicitar una resolución nueva. */
const CONSUMO_AVISO_RANGO = 80;

interface Modulo { name: string; state: string }
interface Compania {
  id: number; name: string; vat: string | false; city: string | false;
  country_id: [number, string] | false; currency_id: [number, string] | false;
  state_id: [number, string] | false; l10n_co_dian_provider: string | false;
  l10n_co_dian_test_environment: boolean; l10n_co_dian_certification_process: boolean;
  l10n_co_dian_demo_mode: boolean;
}
interface Certificado {
  id: number; name: string | false; is_valid: boolean;
  date_end: string | false; loading_error: string | false;
}
interface ModoOperacion {
  id: number; dian_software_operation_mode: string;
  dian_software_id: string | false; dian_software_security_code: string | false;
  dian_testing_id: string | false;
}
interface Diario {
  id: number; name: string; code: string; type: string;
  l10n_co_edi_dian_authorization_number: string | false;
  l10n_co_edi_dian_authorization_date: string | false;
  l10n_co_edi_dian_authorization_end_date: string | false;
  l10n_co_edi_min_range_number: number; l10n_co_edi_max_range_number: number;
  l10n_co_dian_technical_key: string | false;
  l10n_co_edi_debit_note: boolean; l10n_co_edi_is_support_document: boolean;
}

const puesto = (v: unknown) => !(v === false || v === "" || v === null || v === undefined);
const contar = (model: string, domain: unknown[]) => executeKw<number>(model, "search_count", [domain]);

async function main(): Promise<number> {
  const flags = parseFlags();
  const h = new Hallazgos();

  titulo("Módulos");
  const modulos = await searchRead<Modulo>("ir.module.module", [["name", "in", MODULOS_REQUERIDOS]], ["name", "state"], { limit: 50 });
  for (const nombre of MODULOS_REQUERIDOS) {
    const m = modulos.find((x) => x.name === nombre);
    m?.state === "installed" ? h.ok(`${nombre} instalado`) : h.bloqueante(`${nombre} NO instalado (${m?.state ?? "ausente"})`);
  }

  titulo("Compañía");
  const [company] = await searchRead<Compania>("res.company", [], [
    "name", "vat", "city", "country_id", "currency_id", "state_id", "l10n_co_dian_provider",
    "l10n_co_dian_test_environment", "l10n_co_dian_certification_process", "l10n_co_dian_demo_mode",
  ], { limit: 1, order: "id asc" });
  if (!company) { h.bloqueante("No se encontró ninguna compañía"); return h.resumen(); }

  company.country_id && company.country_id[1] === "Colombia"
    ? h.ok("país: Colombia")
    : h.bloqueante(`país debe ser Colombia (actual: ${company.country_id ? company.country_id[1] : "vacío"})`);
  company.currency_id && company.currency_id[1] === "COP"
    ? h.ok("moneda: COP")
    : h.aviso(`moneda: ${company.currency_id ? company.currency_id[1] : "vacío"}`);
  puesto(company.vat) ? h.ok("NIT poblado") : h.bloqueante("NIT (vat) vacío");
  puesto(company.state_id) ? h.ok("departamento poblado") : h.bloqueante("departamento vacío");
  puesto(company.city) ? h.ok("ciudad poblada") : h.bloqueante("ciudad vacía");
  company.l10n_co_dian_provider === "dian"
    ? h.ok("proveedor EDI: dian (servicio directo)")
    : h.bloqueante(`proveedor EDI es "${company.l10n_co_dian_provider}" — debe ser "dian"`);
  if (company.l10n_co_dian_demo_mode) h.bloqueante("modo demo activo: los documentos no salen a la DIAN");

  const fase = company.l10n_co_dian_test_environment ? "PRUEBAS" : "PRODUCCIÓN";
  console.log(`  · fase: ${fase} (test_environment=${company.l10n_co_dian_test_environment}, certification_process=${company.l10n_co_dian_certification_process})`);

  titulo("Certificado de firma digital");
  const certificados = await searchRead<Certificado>("certificate.certificate", [["company_id", "=", company.id]], ["name", "is_valid", "date_end", "loading_error"], { limit: 20 });
  if (certificados.length === 0) {
    h.bloqueante("no hay certificado cargado — bloquea todo el flujo");
  }
  for (const c of certificados) {
    if (puesto(c.loading_error)) { h.bloqueante(`certificado con error de carga: ${c.loading_error}`); continue; }
    if (!c.is_valid) { h.bloqueante(`certificado "${c.name}" no es válido`); continue; }
    const dias = c.date_end ? Math.floor((new Date(c.date_end).getTime() - Date.now()) / 86_400_000) : null;
    if (dias === null) h.aviso(`certificado "${c.name}" sin fecha de expiración`);
    else if (dias < 0) h.bloqueante(`certificado "${c.name}" VENCIDO hace ${-dias} días`);
    else if (dias <= DIAS_AVISO_VENCIMIENTO) h.aviso(`certificado "${c.name}" vence en ${dias} días — iniciar renovación`);
    else h.ok(`certificado "${c.name}" válido, vence en ${dias} días`);
  }

  titulo("Modos de operación DIAN");
  const modos = await searchRead<ModoOperacion>("l10n_co_dian.operation_mode", [["company_id", "=", company.id]], ["dian_software_operation_mode", "dian_software_id", "dian_software_security_code", "dian_testing_id"], { limit: 20 });
  for (const esperado of ["invoice", "bill"] as const) {
    const etiqueta = esperado === "invoice" ? "factura electrónica" : "documento soporte";
    const modo = modos.find((m) => m.dian_software_operation_mode === esperado);
    if (!modo) {
      esperado === "invoice"
        ? h.bloqueante(`falta el modo de operación "${esperado}" (${etiqueta})`)
        : h.aviso(`falta el modo de operación "${esperado}" (${etiqueta}) — se configura después de certificar la factura`);
      continue;
    }
    puesto(modo.dian_software_id) && puesto(modo.dian_software_security_code)
      ? h.ok(`${etiqueta}: Software ID y PIN poblados`)
      : h.bloqueante(`${etiqueta}: falta Software ID o PIN`);
    if (company.l10n_co_dian_certification_process && !puesto(modo.dian_testing_id)) {
      h.bloqueante(`${etiqueta}: proceso de certificación activo pero sin Testing ID`);
    }
    if (!company.l10n_co_dian_test_environment && puesto(modo.dian_testing_id)) {
      h.aviso(`${etiqueta}: en producción pero el Testing ID sigue poblado — limpiarlo`);
    }
  }

  titulo("Diarios");
  const diarios = await searchRead<Diario>("account.journal", [["type", "in", ["sale", "purchase"]]], [
    "name", "code", "type", "l10n_co_edi_dian_authorization_number", "l10n_co_edi_dian_authorization_date",
    "l10n_co_edi_dian_authorization_end_date", "l10n_co_edi_min_range_number", "l10n_co_edi_max_range_number",
    "l10n_co_dian_technical_key", "l10n_co_edi_debit_note", "l10n_co_edi_is_support_document",
  ], { limit: 100, order: "type asc, id asc" });

  if (!diarios.some((d) => puesto(d.l10n_co_edi_dian_authorization_number))) {
    h.bloqueante(`ningún diario tiene resolución DIAN (${diarios.length} de venta/compra revisados)`);
  }
  for (const d of diarios) {
    const marcas = [d.l10n_co_edi_debit_note && "nota débito", d.l10n_co_edi_is_support_document && "doc soporte"].filter(Boolean).join(", ");
    console.log(`  · [${d.type}] ${d.code} — ${d.name}${marcas ? ` (${marcas})` : ""}`);
    if (!puesto(d.l10n_co_edi_dian_authorization_number)) {
      console.log("      sin resolución — histórico o pendiente de configurar");
      continue;
    }
    puesto(d.l10n_co_edi_dian_authorization_date) && puesto(d.l10n_co_edi_dian_authorization_end_date)
      ? h.ok(`${d.code}: vigencia ${d.l10n_co_edi_dian_authorization_date} → ${d.l10n_co_edi_dian_authorization_end_date}`)
      : h.bloqueante(`${d.code}: resolución sin fechas de vigencia`);

    puesto(d.l10n_co_dian_technical_key)
      ? h.ok(`${d.code}: clave técnica poblada`)
      : h.bloqueante(`${d.code}: sin clave técnica — es la que genera el CUFE`);

    const { l10n_co_edi_min_range_number: min, l10n_co_edi_max_range_number: max } = d;
    if (max > min && max > 0) {
      h.ok(`${d.code}: rango ${min}–${max}`);
      const usadas = await contar("account.move", [["journal_id", "=", d.id], ["state", "=", "posted"]]);
      const consumo = (usadas / (max - min + 1)) * 100;
      if (consumo >= CONSUMO_AVISO_RANGO) h.aviso(`${d.code}: rango al ${consumo.toFixed(0)}% — solicitar resolución nueva`);
    } else {
      h.bloqueante(`${d.code}: rango de numeración inválido (${min}–${max})`);
    }
  }

  titulo("Impuestos");
  const impuestos = await contar("account.tax", [["active", "=", true]]);
  const sinTipo = await searchRead<{ id: number; name: string }>("account.tax", [["active", "=", true], ["l10n_co_edi_type", "=", false]], ["name"], { limit: 100 });
  sinTipo.length === 0
    ? h.ok(`${impuestos} impuestos activos, todos con "Tipo de Valor" DIAN`)
    : h.bloqueante(`${sinTipo.length}/${impuestos} impuestos sin "Tipo de Valor": ${sinTipo.slice(0, 8).map((t) => t.name).join(", ")}`);

  titulo("Contactos");
  const raiz: unknown[] = [["active", "=", true], ["parent_id", "=", false]];
  const totalP = await contar("res.partner", raiz);
  const sinTipoId = await contar("res.partner", [...raiz, ["l10n_latam_identification_type_id", "=", false]]);
  const sinVat = await contar("res.partner", [...raiz, ["vat", "=", false]]);
  const sinObl = await contar("res.partner", [...raiz, ["l10n_co_edi_obligation_type_ids", "=", false]]);
  console.log(`  · ${totalP} contactos raíz`);
  sinTipoId === 0 ? h.ok("todos con tipo de identificación") : h.bloqueante(`${sinTipoId} sin tipo de identificación`);
  sinVat === 0 ? h.ok("todos con NIT/documento") : h.bloqueante(`${sinVat} sin NIT/documento — captura manual`);
  sinObl === 0 ? h.ok("todos con responsabilidades fiscales") : h.bloqueante(`${sinObl} sin responsabilidades — correr co:partners`);

  titulo("Productos");
  const totalT = await contar("product.template", [["active", "=", true], ["sale_ok", "=", true]]);
  const sinUnspsc = await contar("product.template", [["active", "=", true], ["sale_ok", "=", true], ["unspsc_code_id", "=", false]]);
  sinUnspsc === 0
    ? h.ok(`${totalT} plantillas vendibles, todas con código UNSPSC`)
    : h.bloqueante(`${sinUnspsc}/${totalT} plantillas vendibles sin código UNSPSC — correr co:unspsc`);

  titulo("Unidades de medida");
  const plantillas = await searchRead<{ uom_id: [number, string] | false }>("product.template", [["active", "=", true], ["sale_ok", "=", true]], ["uom_id"], { limit: 20000 });
  const usadas = [...new Set(plantillas.map((p) => (p.uom_id ? p.uom_id[0] : 0)).filter(Boolean))];
  const uoms = await searchRead<{ id: number; name: string; l10n_co_edi_ubl: string | false }>("uom.uom", [["id", "in", usadas]], ["name", "l10n_co_edi_ubl"], { limit: 200 });
  const sinUbl = uoms.filter((u) => !puesto(u.l10n_co_edi_ubl));
  sinUbl.length === 0
    ? h.ok(`${uoms.length} unidades en uso, todas con código UNECE`)
    : h.bloqueante(`${sinUbl.length}/${uoms.length} unidades en uso sin código UNECE: ${sinUbl.map((u) => u.name).join(", ")}`);

  titulo("Documentos emitidos");
  const porEstado = await executeKw<Array<{ l10n_co_dian_state: string | false; __count: number }>>(
    "account.move", "read_group",
    [[["move_type", "in", ["out_invoice", "out_refund"]]], ["id"], ["l10n_co_dian_state"]],
    { lazy: false },
  );
  if (porEstado.length === 0) console.log("  · sin facturas de venta");
  for (const g of porEstado) console.log(`  · ${g.l10n_co_dian_state || "sin enviar"}: ${g.__count}`);

  // l10n_co_dian_is_enabled es calculado y no almacenado: no admite dominio SQL.
  // Se traen las publicadas sin enviar y se filtra en memoria.
  const publicadas = await searchRead<{ name: string; journal_id: [number, string]; l10n_co_dian_is_enabled: boolean }>(
    "account.move",
    [["move_type", "in", ["out_invoice", "out_refund"]], ["state", "=", "posted"], ["l10n_co_dian_state", "=", false]],
    ["name", "journal_id", "l10n_co_dian_is_enabled"],
    { limit: 500, order: "name asc" },
  );
  const sinEnviar = publicadas.filter((m) => m.l10n_co_dian_is_enabled);
  if (sinEnviar.length > 0) {
    h.aviso(`${sinEnviar.length} facturas publicadas y habilitadas para DIAN pero nunca enviadas — revisar antes de producción`);
    if (flags.verbose) for (const m of sinEnviar) console.log(`      ${m.name} (${m.journal_id[1]})`);
  }
  const rechazadas = await contar("account.move", [["l10n_co_dian_state", "in", ["invoice_rejected", "invoice_sending_failed"]]]);
  if (rechazadas > 0) h.bloqueante(`${rechazadas} documentos rechazados o con envío fallido`);

  return h.resumen();
}

correr(main);
