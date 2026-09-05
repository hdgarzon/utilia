# Módulo de Productos — Design Spec

**Fecha:** 2026-09-04
**Origen:** Utilia lee el catálogo de Odoo pero no lo administra. Crear un producto, corregir su categoría o asignarle proveedor obliga a entrar a Odoo y hacerlo de a uno. Con casi 1.600 plantillas —muchas con categorías duplicadas o mal escritas, y decenas sin proveedor ni impuesto de compra— el mantenimiento del catálogo es hoy el trabajo manual más caro del negocio.

## Estado verificado del Odoo (2026-09-04)

Consultado en modo lectura contra la instancia de producción. **Son una foto del 2026-09-04**: el catálogo se mueve solo, así que los conteos sirven para dimensionar decisiones, no como valores esperados de una prueba.

| Dato | Valor |
|---|---|
| Servidor | Odoo **19.0+e** (Enterprise) |
| Almacenes | 1 — `Utilia`, ubicación de stock `WH/Sabaneta` (id 8) |
| `product.template` (activas) | 1.588 |
| `product.template` incluyendo archivadas | 2.586 |
| `product.product` (variantes) | 2.160 |
| Categorías internas | 24 |
| Categorías de ecommerce (`product.public.category`) | 14 |
| Proveedores (`supplier_rank > 0`) | 24 |
| Impuestos de compra (`type_tax_use = purchase`) | 44 |
| Con imagen | 1.531 |
| Publicados en web | 1.420 |
| Módulos instalados | `stock`, `purchase`, `website`, `website_sale`, `point_of_sale` |

Las 24 categorías internas incluyen duplicados y erratas reales: `JOYERÍA` junto a `JOYERÍA Y ACCESORIOS`, `OBSEQUIIO`, `CONFITERÍA` conviviendo con la genérica `All / Saleable`. Esto es lo que justifica el cambio masivo de categorías.

### Campos verificados como escribibles en `product.template`

`name`, `image_1920`, `type` (`consu` = Bienes / `service` = Servicio / `combo` = Combo), `is_storable` (el "rastreo de inventario"), `list_price`, `standard_price`, `taxes_id`, `supplier_taxes_id`, `categ_id`, `seller_ids`, `is_published`, `public_categ_ids`, `show_availability`, `available_threshold`, `default_code`, `uom_id`, `purchase_ok`, `sale_ok`, `available_in_pos`.

**La única excepción es `qty_available`**: es un campo calculado. Ponerle valor exige crear un `stock.quant` con `inventory_quantity` y ejecutar `action_apply_inventory`, lo que genera un movimiento de inventario real.

## Restricción de negocio (decisión del dueño)

> *"Se pueden cambiar cosas en producción sin problema. A lo que me refiero es a que no se afecten las cantidades en producción: podemos hacer cambios pero el inventario se mantiene."*

Traducido a una regla de arquitectura, no a disciplina:

**Utilia nunca genera movimientos de inventario.** El módulo escribe atributos de catálogo en producción sin restricción, pero no toca `stock.quant`, `stock.move` ni `stock.inventory`, y no escribe `qty_available`, `inventory_quantity` ni `free_qty`. Esto se hace cumplir con una lista blanca en el módulo de escritura (§ Arquitectura 2), no con una convención.

### Corolario: el costo solo se escribe al crear

`standard_price` sí es escribible, pero escribirlo sobre un producto **que ya tiene stock** dispara una revalorización contable del inventario en Odoo. Sobre un producto nuevo con 0 unidades no produce ningún asiento.

Por eso: el costo se captura en la carga masiva (producto nuevo, seguro) y queda **excluido de la edición masiva de productos existentes**. Es la misma regla de arriba aplicada al único campo que la burla por la puerta de atrás.

## Objetivo

Que el ciclo quede así: abrir `/productos` → filtrar ("sin proveedor", "categoría PAPELERÍA") → seleccionar → aplicar el cambio a los N de una vez. Y para producto nuevo: abrir `/productos/cargar` → pegar la lista del proveedor desde Excel → corregir lo que la hoja marque en rojo → **Crear en Odoo**.

## Alcance

**Fase 1 — Catálogo y edición masiva**
- Listado de `product.template` con búsqueda, filtros y paginación.
- Filtros de *problemas*: sin imagen, sin categoría web, sin proveedor, sin impuesto de compra, sin publicar.
- Selección múltiple y acciones masivas: categoría interna, categoría de ecommerce, publicar/despublicar, impuesto de compra, asignar proveedor.
- Resultado por producto (no todo-o-nada): "142 aplicados, 3 fallaron: …".

**Fase 2 — Carga masiva**
- Hoja editable con validación en vivo contra los catálogos reales de Odoo.
- Importar CSV/XLSX que **rellena la hoja** (no es un flujo aparte).
- Imagen por link o por archivo, con reducción en el navegador.
- Borrador persistente reanudable, con reintento solo de las filas fallidas.
- Exportable de "cantidades pendientes de cargar" para el ajuste manual en Odoo.

**Fuera de alcance**
- Cualquier ajuste de inventario desde Utilia (restricción de negocio, permanente — no es un "v2").
- Edición del costo sobre productos existentes (§ Corolario).
- Variantes: el módulo trabaja a nivel `product.template`. Crear atributos y variantes se sigue haciendo en Odoo.
- Edición producto-por-producto en un formulario de detalle. La v1 edita en masa; para un solo producto, Odoo ya sirve.
- Archivar o eliminar productos.
- Escritura de precio de venta en masa (`list_price`): fuera de la v1 por prudencia comercial, no por impedimento técnico.

## Arquitectura

### 1. Lectura del catálogo — `src/lib/products/catalog.ts`

El listado **lee en vivo de Odoo**, no de Postgres. Razones:

1. Todo lo editable vive en `product.template`; `ProductInsight` es a nivel de variante (más filas que plantillas) y no guarda imagen, tipo, impuesto, publicado ni proveedor. Cubrirlo exigiría una tabla espejo nueva, un job de sync nuevo y write-through en cada edición.
2. Después de un cambio masivo la tabla tiene que reflejar la verdad **de inmediato**. Con un espejo en Postgres el usuario aplicaría un cambio y seguiría viendo el valor viejo hasta el próximo sync.
3. Los filtros se traducen a dominios de Odoo, que ya resuelven búsqueda y paginación del lado del servidor. Menos de 2.000 registros con `limit: 50` es una consulta trivial.

```ts
listTemplates(filters, page) → { rows: CatalogRow[], total: number }
```

Construye el dominio desde los filtros (`[["categ_id","=",id], ["is_published","=",false]]`), pide una página con `search_read`, y **enriquece** cada fila con `ProductInsight` desde Postgres (rotación, días de stock, venta diaria) haciendo `findMany` por `odooTemplateId in [...]`. Postgres aporta la analítica que Odoo no calcula barato; Odoo aporta la verdad del catálogo.

`getCatalogOptions()` trae las listas de referencia: categorías internas, categorías web, impuestos de compra y proveedores. Alimenta tanto los filtros como los selectores de la hoja de carga. La página la llama **una sola vez por request**, en el mismo `Promise.all` que el listado, y pasa el resultado como prop — por eso no lleva memoización. Si algún día la llamara un segundo componente, ahí sí valdría envolverla en `cache()` de React.

Si Odoo no responde, la página muestra un estado de error explícito en vez de una tabla vacía silenciosa — el patrón que ya usan `/inventario` y `/financiero`.

### 2. Escritura — `src/lib/products/odoo-catalog-write.ts`

Módulo hermano de `src/lib/odoo-write.ts`, con el mismo contrato: **solo se invoca desde server actions disparadas por un clic; ningún sync, cron ni route handler lo importa.**

La barrera de inventario es una constante del módulo:

```ts
// Campos que este módulo puede escribir. La lista es EXACTAMENTE lo que el
// módulo escribe hoy, ni un campo más: cualquier cosa fuera de ella se rechaza
// antes de salir a la red. No es una convención — es la barrera que garantiza
// que Utilia jamás mueva inventario en producción.
//
// Regla para mantenerla: un campo entra en el MISMO cambio que introduce
// quien lo escribe, nunca antes. Los de creación de producto (`name`, `type`,
// `is_storable`, `list_price`, `image_1920`, `show_availability`,
// `standard_price`) entran con `createTemplate`, en Fase 2.
const WRITABLE_FIELDS = new Set([
  "categ_id", "is_published", "public_categ_ids",
  "supplier_taxes_id", "seller_ids",
]);

// Modelos intocables. Escribir en cualquiera de estos genera movimiento de
// inventario, que es exactamente lo que el dueño pidió evitar.
const FORBIDDEN_MODELS = new Set(["stock.quant", "stock.move", "stock.inventory"]);
```

`assertWritable(fields)` lanza si aparece un campo fuera de la lista. `qty_available`, `inventory_quantity` y `free_qty` no están en `WRITABLE_FIELDS`, así que quedan bloqueados por construcción; el `FORBIDDEN_MODELS` cierra la vía de escribir el modelo directamente.

API:

```ts
createTemplate(input: NewProductInput): Promise<number>          // devuelve odooTemplateId
updateTemplates(ids: number[], patch: TemplatePatch): Promise<BulkResult>
```

`WRITABLE_FIELDS` es una barrera de **campo**, no de operación: `standard_price` está en la lista porque `createTemplate` lo escribe. La exclusión del costo en la edición masiva (§ Corolario) se hace en el **tipo** `TemplatePatch`, que solo admite `categ_id`, `public_categ_ids`, `is_published`, `supplier_taxes_id` y `seller_ids`. Son dos barreras distintas y ambas hacen falta.

`updateTemplates` procesa en lotes de 50 y **captura el error de cada lote por separado**, devolviendo `{ ok: number[], failed: Array<{id, error}> }`. Un producto archivado o con una restricción de Odoo no puede tumbar la operación entera.

Reusa `translateOdooError` de `odoo-write.ts` para los mensajes en español; se extiende con los casos nuevos (categoría inválida, impuesto inexistente, imagen no descargable).

**Timeout:** igual que `odoo-write.ts`, este camino acota cada RPC (`ODOO_WRITE_TIMEOUT_MS = 60_000`). El cliente compartido no tiene timeout por defecto a propósito, y el camino de escritura no debe heredarlo.

### 3. Proveedor en masa — semántica de reemplazo

`seller_ids` es un one2many a `product.supplierinfo`. **Decisión del dueño: reemplazar, no agregar.** La acción borra los `supplierinfo` existentes del producto y deja el nuevo como único:

```ts
seller_ids: [[5, 0, 0], [0, 0, { partner_id }]]   // 5 = limpiar todo, 0 = crear
```

Esto destruye precios y plazos de proveedor ya cargados en Odoo y es irreversible. Por eso el diálogo **muestra cuántos de los seleccionados ya tienen proveedor** antes de confirmar ("38 de los 142 seleccionados ya tienen proveedor asignado; se perderá"). La decisión es del usuario; el aviso es obligación del sistema.

### 4. Modelo de datos — `prisma/schema.prisma`

Solo la carga masiva necesita persistencia. El listado no guarda nada.

```prisma
model ProductImportBatch {
  id        String              @id @default(cuid())
  name      String                                    // "Lista Distribuidora X - sep"
  status    ProductImportStatus @default(DRAFT)
  createdBy String?                                   // User.id
  rows      ProductImportRow[]
  createdAt DateTime            @default(now())
  updatedAt DateTime            @updatedAt

  @@index([status])
}

enum ProductImportStatus {
  DRAFT     // en edición
  CREATING  // reclamo activo mientras se crea en Odoo
  DONE      // todas las filas OK
  PARTIAL   // al menos una fila con error, reintentable
}

model ProductImportRow {
  id       String   @id @default(cuid())
  batch    ProductImportBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  batchId  String
  rowIndex Int                                        // orden en la hoja

  // Campos del producto
  name              String
  productType       String   @default("consu")        // "consu" | "service" | "combo"
  isStorable        Boolean  @default(true)           // "rastreo de inventario"
  qtyOnHand         Float?                            // capturado, NUNCA escrito en Odoo
  salePrice         Float?
  cost              Float?
  purchaseTaxIds    Int[]                             // account.tax ids
  categoryId        Int?                              // product.category id
  imageUrl          String?                           // link
  imageData         String?  @db.Text                 // base64, ya reducido en el navegador

  // Ecommerce
  isPublished       Boolean  @default(false)
  publicCategoryIds Int[]                             // product.public.category ids
  showAvailability  Boolean  @default(false)

  // Proveedor
  supplierPartnerId Int?                              // res.partner id

  // Resultado
  status         ProductImportRowStatus @default(PENDING)
  odooTemplateId Int?
  error          String?

  @@index([batchId])
  @@unique([batchId, rowIndex])
}

enum ProductImportRowStatus {
  PENDING
  OK
  ERROR
}
```

**Sobre `imageData`:** decisión del dueño — el borrador guarda las imágenes subidas para poder salir y volver. Se acota con dos topes duros:

- La imagen se reduce **en el navegador** a máximo 1920px de lado (el mismo tope al que Odoo la reduciría) y se codifica JPEG q0.85 antes de tocar el servidor. Rechazo si el base64 resultante supera **500 KB**.
- Máximo **200 filas por lote**.

Peor caso teórico 100 MB, y transitorio: al crear la fila con éxito, `imageData` se pone a `null` en el mismo `update` que graba el `odooTemplateId`. Un lote terminado no arrastra imágenes.

### 5. Validación — `src/lib/products/import-schema.ts`

Un schema Zod por fila, más una capa de validación referencial contra los catálogos vivos de Odoo (`getCatalogOptions`). Devuelve errores **por celda**, no por fila, para que la hoja pueda marcar en rojo la celda exacta:

```ts
validateRow(row, options) → { field: string; message: string }[]
```

Reglas:
- `name` obligatorio, no vacío.
- `type = "service"` o `"combo"` fuerza `isStorable = false` (Odoo solo admite rastreo de inventario en bienes) y anula `qtyOnHand`.
- `categoryId`, `purchaseTaxIds`, `publicCategoryIds` y `supplierPartnerId` deben existir en el catálogo; si vienen del CSV como texto, se resuelven por nombre exacto y si no matchean, se marca la celda con las opciones sugeridas.
- `salePrice` y `cost` ≥ 0.
- `isPublished = true` sin `publicCategoryIds` es advertencia, no error (el producto queda publicado pero sin categoría en la tienda).
- `imageUrl` debe ser `http(s)`. La descarga se intenta en el servidor **al crear**, no al validar; si falla, el producto se crea igual **sin imagen** y la fila queda OK con una advertencia. Una imagen rota no debe costar el producto.

### 6. Importación de archivo — `src/lib/products/csv-import.ts`

Parsea CSV (y XLSX pegado como TSV desde Excel/Sheets) a filas crudas y las mapea a columnas de la hoja. Un paso de mapeo de columnas deja al usuario decir "la columna 3 del archivo es el costo" cuando los encabezados no coinciden. El resultado **rellena la hoja editable**; no crea nada por sí solo.

Se reusa el `escapeCsvCell`/`buildCsv` que ya existe en `src/lib/csv.ts` para las exportaciones (plantilla vacía y pendientes de inventario).

### 7. Rutas y componentes

```
src/app/(dashboard)/productos/
  page.tsx                 # listado (server component)
  actions.ts               # server actions de las acciones masivas
  cargar/
    page.tsx               # hoja de carga
    actions.ts             # guardar borrador / crear en Odoo
src/components/products/
  CatalogTable.tsx         # tabla con selección múltiple
  CatalogFilters.tsx       # filtros + búsqueda
  BulkActionBar.tsx        # barra que aparece con N seleccionados
  BulkActionDialog.tsx     # confirmación (incluye el aviso de proveedor)
  ImportSheet.tsx          # hoja editable
  ImportSheetRow.tsx       # una fila, con validación por celda
  ImageCell.tsx            # link o archivo, con reducción en canvas
  ImportResult.tsx         # resumen + reintento + pendientes de inventario
```

Nav: entrada `Productos` (icono `Boxes`) en `src/components/layout/nav-config.tsx`, entre Inventario y Categorías.

Los componentes de la hoja se mantienen chicos a propósito: `ImportSheetRow` y `ImageCell` concentran el estado por fila para que `ImportSheet` no crezca a un archivo imposible de razonar.

### 8. Flujo de creación

1. El usuario da "Crear en Odoo". La server action marca el lote `CREATING`.
2. Por cada fila `PENDING` o `ERROR`, en serie:
   - Resuelve la imagen: `imageData` si existe, si no descarga `imageUrl` (timeout 15 s) y la convierte a base64. Si falla, sigue sin imagen y anota la advertencia.
   - `createTemplate(...)` → `odooTemplateId`.
   - Marca la fila `OK`, guarda el id, y **borra `imageData`**.
   - Si Odoo rechaza, marca `ERROR` con el mensaje traducido y **continúa con la siguiente**.
3. Al terminar: `DONE` si todas OK, `PARTIAL` si alguna falló.
4. La pantalla de resultado muestra el resumen, un botón de reintentar solo las fallidas, y la tabla de **cantidades pendientes de cargar** (las filas con `qtyOnHand` no nulo) con su CSV descargable.

**Serie y no paralelo** a propósito: 200 creaciones concurrentes contra un Odoo de producción es una forma fácil de degradarlo, y el orden de la hoja se conserva en los resultados.

**Reanudación:** si el proceso muere a mitad (timeout serverless, cierre de pestaña), el lote queda en `CREATING` con las filas ya creadas marcadas `OK`. Volver a entrar y darle "Crear en Odoo" retoma solo las que faltan. Como cada fila se marca `OK` inmediatamente después de su `create`, **no se puede crear el mismo producto dos veces** salvo que el proceso muera entre el `create` y el `update` — ventana de milisegundos, y el peor caso es un duplicado visible en Odoo, no un movimiento de inventario.

## Manejo de errores

| Situación | Comportamiento |
|---|---|
| Odoo caído al abrir `/productos` | Estado de error explícito con botón de reintentar. Nunca tabla vacía sin explicación. |
| Un producto falla en una acción masiva | Los demás se aplican. El resumen lista el id, el nombre y el motivo. |
| Imagen por link no descargable | El producto se crea sin imagen; la fila queda OK con advertencia. |
| Fila rechazada por Odoo al crear | La fila queda `ERROR` con el mensaje traducido; el resto del lote continúa. |
| Proceso de creación interrumpido | El lote queda reanudable; solo se reintentan las filas no-OK. |
| Campo fuera de la lista blanca | `assertWritable` lanza antes de salir a la red. Es un bug de programación, no un error de usuario. |

## Pruebas

El repo no tiene suite de pruebas automatizadas; la verificación es manual más `npm run build` y `npm run lint`. Lo que hay que verificar, en orden:

1. **La barrera de inventario, primero.** `assertWritable` rechaza `qty_available`, `inventory_quantity`, `free_qty` y cualquier campo no listado. Es la garantía central del diseño y se prueba antes que nada.
2. Validación por celda: categoría inexistente, impuesto inexistente, servicio con rastreo, precio negativo.
3. Acción masiva con un id inválido en el lote: los válidos se aplican, el inválido se reporta.
4. Aviso de reemplazo de proveedor: el conteo de "ya tienen proveedor" es correcto.
5. Creación con imagen por link, por archivo y sin imagen.
6. Reanudación: matar el proceso a mitad de un lote de 10 y verificar que al reintentar se crean solo las que faltaban, sin duplicados.
7. **Verificación en Odoo tras la prueba completa:** `qty_available` de los productos tocados no cambió, y no aparecieron `stock.move` nuevos con origen en Utilia.

## Decisiones registradas

| Decisión | Elegida | Alternativa descartada |
|---|---|---|
| Método de carga masiva | Hoja editable + importar CSV que la rellena | Solo importar archivo; solo hoja |
| Escritura en producción | Crear y editar sin restricción, **nunca stock** | Solo crear; cero escrituras (exportar CSV para el importador de Odoo) |
| Cantidad a la mano | Se captura, no se escribe; se exporta como pendiente | Aplicar ajuste de inventario en Odoo |
| Imagen | Link **y** archivo | Solo link; solo archivo |
| Imágenes en el borrador | Se guardan, con topes de 1920px / 500 KB / 200 filas | No guardar archivos, solo links |
| Proveedor en masa | **Reemplazar** el existente, con aviso de cuántos se pierden | Agregar sin borrar; decidir en el momento |
| Origen del listado | Odoo en vivo + enriquecido con `ProductInsight` | Tabla espejo en Postgres con sync propio |
| Costo (`standard_price`) | Solo al crear | Editable en masa (dispara revalorización) |

## Verificación de la barrera (Fase 1)

Ejecutada el 2026-09-05, tras aplicar las cinco acciones masivas (categoría
interna, categoría de ecommerce, publicar/quitar de la tienda, impuesto de
compra y proveedor) sobre 10 productos reales de producción, elegidos con el
filtro "Sin proveedor" para poder ejercitar también la acción de proveedor sin
pisar uno existente: `qty_available` sin cambios en las 1.602 plantillas
activas, y cero movimientos de `stock.move` nuevos (0 antes, 0 después). La
barrera se comporta como está diseñada.

**Alcance real de esa corrida.** El verificador usado entonces leía solo
plantillas activas, así que las ~998 archivadas quedaron fuera de la
comparación de cantidades. La conclusión se sostiene igual, porque el conteo
de `stock.move` **no** filtra por `active`: un movimiento sobre cualquier
producto, archivado incluido, habría aparecido allí, y no apareció. Aun así,
el script se endureció después para leer ambos estados — hoy compara 2.600
plantillas — junto con paginado, fecha de Colombia y un veredicto que siempre
dice cuántas comparó. Una corrida futura cubre el catálogo completo.

Los 10 productos se restauraron a sus valores originales de `categ_id`,
`is_published`, `public_categ_ids`, `supplier_taxes_id` y `seller_ids`
inmediatamente después de la prueba, usando el mismo camino de escritura de
la app (`updateTemplates`, con la barrera de por medio). Una relectura
posterior de los 10 productos confirmó una coincidencia exacta con los
valores guardados antes de tocarlos: cero diferencias.
