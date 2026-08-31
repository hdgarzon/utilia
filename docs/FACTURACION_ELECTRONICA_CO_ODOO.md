# Facturación electrónica DIAN — configuración en Odoo 19

Referencia técnica. El trámite ante la DIAN va en
[FACTURACION_ELECTRONICA_CO_TRAMITE.md](./FACTURACION_ELECTRONICA_CO_TRAMITE.md).

**Ruta: servicio directo de la DIAN** (`l10n_co_dian_provider = dian`), sin proveedor
tecnológico. El módulo que actúa es `l10n_co_dian`; `l10n_co_edi` queda instalado pero
inactivo, y su formato EDI `ubl_carvajal` no interviene — verificado: las facturas existentes
tienen `l10n_co_dian_is_enabled = true` y `edi_state = false`.

> Valores de ejemplo ficticios. El NIT, la resolución, los rangos, el Software ID, el PIN y la
> clave técnica no van en el repositorio.

---

## 1. Estado actual

`npm run co:audit`, 2026-08-26. Odoo **19.0 Enterprise**. **5 bloqueantes, 2 avisos.**

### Resuelto

| Componente | Estado |
|---|---|
| `l10n_co`, `l10n_co_dian`, `certificate`, `product_unspsc` | instalados |
| Proveedor EDI | `dian` — servicio directo |
| Fase | pruebas (`test_environment = true`) |
| Catálogo UNSPSC | 54.564 códigos |
| Impuestos con `l10n_co_edi_type` | 58 / 58 |
| Compañía: país, moneda COP, NIT, departamento, ciudad | completos |
| Contactos con tipo de identificación | 34 / 34 |
| Contactos con responsabilidades fiscales | 34 / 34 — aplicado con `co:partners` |
| Plantillas vendibles con código UNSPSC | 1526 / 1526 — aplicado con `co:unspsc` |
| Contacto "Consumidor Final" | ya existe, documento `222222222222` |

### Bloqueantes

Los cinco esperan un dato externo. Nada más se puede cerrar desde el código.

| # | Falta | Depende de | Cómo se resuelve |
|---|---|---|---|
| 1 | Certificado de firma digital — 0 cargados | trámite paso 2 | UI, §3.1 |
| 2 | Modo de operación `invoice` | trámite paso 4 | UI, §3.2 |
| 3 | Ningún diario con resolución DIAN | trámite paso 5 | UI, §3.4 |
| 4 | 14 contactos sin NIT/documento | captura manual | `co:partners` los lista |
| 5 | La unidad "Units" sin código UNECE (`l10n_co_edi_ubl`) | dato del contador | UI, §3.5 |

### Avisos

- Falta el modo de operación `bill` (documento soporte). Se configura después de certificar la
  factura, no antes.
- **8 facturas publicadas con `l10n_co_dian_is_enabled = true` y sin enviar.** Están en el
  diario `INV` y no tienen CUFE. Revisar con el contador antes de pasar a producción: no
  deben salir a la DIAN por accidente.

---

## 2. Alcance

**Fase 1:** factura electrónica tipo 01, notas crédito, notas débito, documento soporte.

**Fuera de alcance:** documento equivalente electrónico P.O.S. (verificado: `pos.config`,
`pos.session` y `pos.order` no exponen ningún campo DIAN, y los tipos EDI soportados son
`01, 02, 03, 04, 91, 92, 96`), nómina electrónica, y reflejar el CUFE en el dashboard de
Utilia.

---

## 3. Configuración

Nombres de campo verificados contra la instancia. **Ajustes → Contabilidad → sección
Colombia**, salvo los diarios.

### 3.1 Certificado — `certificate.certificate`

| Campo | Valor |
|---|---|
| `content` | el archivo `.p12` |
| `pkcs12_password` | contraseña del certificado |
| `company_id` | la compañía |

Odoo deriva `subject_common_name`, `serial_number`, `date_start`, `date_end` e `is_valid`.
**Verifica `is_valid = true` y que `loading_error` esté vacío** antes de seguir: un
certificado mal cargado falla en silencio hasta el primer envío. El audit lo comprueba y
avisa 60 días antes del vencimiento.

### 3.2 Modos de operación — `l10n_co_dian.operation_mode`

Dos registros, uno por tipo de documento. Los tres primeros campos son obligatorios.

| Campo | Factura | Documento soporte |
|---|---|---|
| `dian_software_operation_mode` | `invoice` | `bill` |
| `dian_software_id` | Software ID | el suyo |
| `dian_software_security_code` | PIN | el suyo |
| `dian_testing_id` | TestSetId | el suyo |

Crea primero el de factura. El de documento soporte va **después** de certificar la factura —
no se mezclan las dos certificaciones.

### 3.3 Fase

| Campo | Pruebas | Producción |
|---|---|---|
| `l10n_co_dian_test_environment` | `true` | `false` |
| `l10n_co_dian_certification_process` | `true` | `false` |
| `l10n_co_dian_demo_mode` | `false` | `false` |

`demo_mode` genera documentos que no salen a la DIAN. El audit lo marca como bloqueante si
está activo, porque enmascara el diagnóstico.

Con `certification_process = true` aparecen tres contadores en los ajustes:
`l10n_co_dian_cert_invoice_count`, `l10n_co_dian_cert_credit_count` y
`l10n_co_dian_cert_debit_count` — los documentos que faltan por certificar.

### 3.4 Diarios

Existen `INV — Customer Invoices` y `BILL — Vendor Bills`, genéricos y sin resolución. **No
los modifiques**: `INV` tiene 8 facturas publicadas sin CUFE. Déjalos como histórico y crea
diarios limpios.

| Diario | Tipo | Marca |
|---|---|---|
| Factura electrónica | `sale` | — |
| Nota crédito | `sale` | — |
| Nota débito | `sale` | `l10n_co_edi_debit_note = true` |
| Documento soporte | `purchase` | `l10n_co_edi_is_support_document = true` |

Campos DIAN del diario de factura:

| Campo | Ejemplo ficticio |
|---|---|
| `l10n_co_edi_dian_authorization_number` | `18760000000000` |
| `l10n_co_edi_dian_authorization_date` | `2026-01-01` |
| `l10n_co_edi_dian_authorization_end_date` | `2027-01-01` |
| `l10n_co_edi_min_range_number` | `1` |
| `l10n_co_edi_max_range_number` | `5000` |
| `l10n_co_dian_technical_key` | clave técnica — genera el CUFE |

El **prefijo** va en la secuencia del diario y debe coincidir carácter por carácter con el
autorizado en la resolución. Un prefijo distinto es rechazo inmediato.

### 3.5 Unidades de medida

`uom.uom` expone `l10n_co_edi_ubl`, el código UNECE que viaja en el XML. Las 1526 plantillas
vendibles usan **una sola unidad, "Units"**, y está vacía. Es un campo, una vez. El código lo
confirma el contador — no lo adivines.

---

## 4. Datos maestros

**Ya aplicados.** Ambos scripts son idempotentes: vuelven a correrse sin efecto si no hay nada
pendiente. Dry-run por defecto, escriben solo con `--apply`, y nunca sobrescriben un campo ya
poblado.

### 4.1 `npm run co:unspsc` — aplicado

1526 plantillas, 12 categorías. Códigos verificados contra el catálogo cargado en Odoo: el
script comprueba que cada uno exista **y que su nombre coincida**, y aborta si difiere.

| Categoría | Código | Nombre en el catálogo |
|---|---|---|
| Papelería | `44120000` | Office supplies |
| Cacharrería | `52150000` | Domestic kitchenware and kitchen supplies |
| Piñatería | `60140000` | Toys and games |
| Cosméticos | `53131619` | Cosmetics |
| Cuidado personal | `53130000` | Personal care products |
| Juguetería | `60140000` | Toys and games |
| Tecnología | `43210000` | Computer Equipment and Accessories |
| Confitería | `50160000` | Chocolate and sugars and sweeteners and confectionary products |
| Servicios | `80160000` | Business administration services |
| Joyería y accesorios | `54100000` | Jewelry |

Cacharrería es la categoría más heterogénea. Si la DIAN objeta líneas de esa categoría, es la
primera a refinar a mano.

**Nota de historia:** 14 plantillas quedaron fuera en la primera pasada por no tener categoría
(13) o estar en una categoría de un solo ítem (1). Se categorizaron a mano y se volvió a
correr el script. Se verificó antes de mover nada que todas las categorías comparten las mismas
cuentas de ingreso y gasto, así que el cambio no tuvo efecto contable.

Uno de esos 14, **"Pago Tarjeta Bold"**, es un servicio que parece artefacto del método de pago
del POS. Quedó en la categoría Servicios con su código, pero sigue marcado como vendible y
**no debería aparecer como línea de una factura**. Pendiente de revisar aparte; no se tocó
`sale_ok` porque podría afectar el método de pago del POS.

### 4.2 `npm run co:partners` — aplicado

- **32 contactos** recibieron la responsabilidad `R-99-PN` ("No aplica"), el valor correcto
  para quien no es gran contribuyente, autorretenedor ni agente de retención. Las cinco
  responsabilidades cargadas son `O-13`, `O-15`, `O-23`, `O-47` y `R-99-PN`.
- **14 contactos siguen sin NIT/documento.** El script los lista y **no los inventa**. Es
  captura manual y es el bloqueante 4.
- **"Consumidor Final"** ya existía. El script lo detecta y no duplica.

---

## 5. Set de pruebas

1. Emitir facturas, notas crédito y notas débito hasta agotar los contadores de §3.3.
2. Seguir el estado en `l10n_co_dian_state`: `invoice_pending` → `invoice_accepted`. Los otros
   valores son `invoice_rejected` e `invoice_sending_failed`.
3. El CUFE queda en `l10n_co_edi_cufe_cude_ref`. El detalle de cada intercambio con la DIAN
   está en `l10n_co_dian_document_ids` del asiento — ahí se lee el motivo de un rechazo.
4. Corregir el dato de origen y reemitir. No reintentar sin cambiar nada.

Causas de rechazo más frecuentes, en orden: prefijo o rango que no coinciden con la
resolución, contacto sin documento o sin responsabilidades fiscales, unidad de medida sin
código UNECE, y producto sin código de clasificación.

---

## 6. Producción

1. `l10n_co_dian_certification_process` → `false`
2. `l10n_co_dian_test_environment` → `false`
3. Limpiar `dian_testing_id` del modo de operación (el audit lo avisa si queda)
4. Confirmar que el diario apunta a la resolución **de producción**
5. Emitir una factura real y verificar `invoice_accepted` con su CUFE
6. Repetir el ciclo para el documento soporte, con el modo `bill`

---

## 7. Criterio de éxito

- `npm run co:audit` sale con código 0.
- `l10n_co_dian_test_environment = false` y `l10n_co_dian_certification_process = false`.
- Al menos una factura real con `l10n_co_dian_state = invoice_accepted` y
  `l10n_co_edi_cufe_cude_ref` poblado.
- El documento soporte emite y es aceptado.

---

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Contraseña del certificado perdida | Gestor de contraseñas antes de cargarlo en Odoo |
| Certificado vencido detiene la facturación | El audit avisa 60 días antes de `date_end` |
| Rango de numeración agotado | El audit avisa al 80% de `l10n_co_edi_max_range_number` |
| Envío accidental de las 8 facturas históricas | No tocar el diario `INV` |
| Confundir clave técnica con número de resolución | Son campos distintos; el audit exige ambos |
| POS sin documento equivalente | Fase 2 — con plazo normativo, no indefinida |

---

## 9. Scripts

En `scripts/`. Leen por defecto; escriben solo con `--apply`.

| Comando | Qué hace |
|---|---|
| `npm run co:audit` | Semáforo de configuración. Exit 1 si hay bloqueantes. `-- --verbose` detalla. |
| `npm run co:unspsc` | Plan de códigos UNSPSC por categoría. `-- --apply` escribe. |
| `npm run co:partners` | Responsabilidades fiscales y consumidor final. `-- --apply` escribe. |

Comparten `scripts/co-edi-shared.ts` y usan `odooRpc` de `src/lib/odoo.ts`, un export
reservado para mantenimiento desde la CLI — el sync nunca escribe en Odoo.
