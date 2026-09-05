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

Construye el dominio desde los filtros (`[["categ_id","=",id], ["is_published","=",false]]`) y pide una página con `search_read`. Hoy **no** enriquece con `ProductInsight`: esa analítica (rotación, días de stock, venta diaria) solo tiene sentido el día que el listado sume una columna que la necesite, y entra en ese mismo cambio — no antes. La decisión de leer en vivo de Odoo no depende de ese enriquecimiento futuro: se sostiene sola por las tres razones de arriba (campos a nivel de plantilla, verdad inmediata tras escribir, filtrado del lado de Odoo).

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

`assertWritable(fields)` lanza si aparece un campo fuera de la lista. `qty_available`, `inventory_quantity` y `free_qty` no están en `WRITABLE_FIELDS`, así que quedan bloqueados por construcción.

`assertModelAllowed` es una barrera más angosta de lo que parece a primera vista: hoy se llama una sola vez, dentro de `updateTemplates`, con la constante `MODEL = "product.template"` del propio módulo — la llamada es una tautología en tiempo de ejecución, porque `MODEL` nunca cambia en el camino de escritura actual. Protege contra que alguien edite esa constante por descuido en el futuro, no contra que otro módulo del código base llame directo `odooRpc.executeKw("stock.quant", …)`; ese caso queda fuera de lo que esta función puede impedir.

API:

```ts
createTemplate(input: NewProductInput): Promise<number>          // devuelve odooTemplateId
updateTemplates(ids: number[], patch: TemplatePatch): Promise<BulkResult>
```

`WRITABLE_FIELDS` contiene exactamente los cinco campos de Odoo que el módulo escribe **hoy**: `categ_id`, `is_published`, `public_categ_ids`, `supplier_taxes_id` y `seller_ids`. `standard_price` **no** está en la lista — no tiene escritor todavía.

`TemplatePatch` es el tipo de **intención a nivel de app**, no de Odoo: usa nombres propios (`categoryId`, `publicCategoryIds`, `isPublished`, `purchaseTaxIds`, `supplierPartnerId`), y es `toOdooValues` quien los traduce a los nombres de campo de Odoo antes de que el resultado pase por `assertWritable`. Los campos de creación —incluido `standard_price`— entran junto con `createTemplate`, en el mismo cambio de Fase 2 que los escribe: hasta entonces no tienen lugar ni en `WRITABLE_FIELDS` ni en `TemplatePatch`.

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

El repo tiene suite de pruebas automatizadas (vitest): 32 pruebas en 4 archivos, incluida la barrera de escritura. Además de correrla, hay que verificar manualmente, con `npm run build` y `npm run lint`, en orden:

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
| Origen del listado | Odoo en vivo (el enriquecimiento con `ProductInsight` queda para cuando haya una columna que lo necesite) | Tabla espejo en Postgres con sync propio |
| Costo (`standard_price`) | Solo al crear | Editable en masa (dispara revalorización) |

## Verificación de la barrera (Fase 1)

Ejecutada el 2026-09-05: las cinco acciones masivas (categoría interna,
categoría de ecommerce, publicar/quitar de la tienda, impuesto de compra y
proveedor) se aplicaron sobre 10 productos reales de producción, elegidos
con el filtro "Sin proveedor" para poder ejercitar también la acción de
proveedor sin pisar uno existente. Esta sección junta hechos de **dos
corridas distintas del verificador** —la original y la corregida—, así que
van por separado para no atribuirle a una lo que solo probó la otra.

**Lo que sí bracketó la escritura real** (corrida original, con la primera
versión de `scripts/verify-inventario.ts`): una foto de `qty_available`
antes de las seis acciones y otra después, sobre las **1.602 plantillas
activas**, sin diferencias. Esa misma corrida reportó además "0 movimientos
antes, 0 después", pero esa cifra puntual es inservible: el script calculaba
la fecha en UTC, no en Colombia, así que después de las 7pm locales su
ventana quedaba casi vacía. Que la escritura ocurrió y fue benigna quedó
confirmado por una vía independiente del script: lectura directa en Odoo
justo después de las seis acciones (los 10 productos con exactamente los
valores esperados) y, tras restaurar los cinco campos a su valor original
por el mismo camino de escritura de la app (`updateTemplates`, con la
barrera de por medio), una relectura campo por campo con cero diferencias
contra la foto tomada antes de tocar nada.

**Lo que el verificador corregido todavía no ha probado:** después de esa
prueba, `scripts/verify-inventario.ts` se corrigió — fecha Colombia,
paginado, plantillas archivadas incluidas, y la métrica de "movimientos
totales" cambiada a "ajustes de inventario" (`is_inventory = true`). Las
corridas que validaron esas correcciones se hicieron **a propósito sin
ninguna acción masiva de por medio** — solo para confirmar que el script
cuenta bien —, y por eso ven **2.600 plantillas** (activas + archivadas,
contra las 1.602 solo-activas de la corrida original) con 0 ajustes antes y
0 después. **El verificador en su forma final —el que queda en el
repo— todavía no ha bracketado una escritura real.** La próxima vez que se
corra alrededor de una acción masiva de verdad será la primera vez que lo
haga con la métrica correcta.

Dicho eso, "cero ajustes de inventario el día de la prueba" sigue siendo una
afirmación sostenida, aunque por un camino indirecto: el conteo de ajustes
es acumulado desde la medianoche Colombia, no un delta entre dos marcas
puestas alrededor de la escritura. La foto `antes` de la corrida corregida
se tomó ese mismo 2026-09-05, después de que las seis acciones originales ya
se hubieran ejecutado y restaurado — así que su "0 ajustes" ya cubre esa
ventana. Si las seis acciones originales hubieran generado un ajuste, esta
foto lo habría mostrado. Esto no reemplaza un bracket dedicado con la
métrica correcta, pero corrobora con esa métrica lo que la corrida original
solo pudo sugerir con una métrica rota.

### Por qué se mide en ajustes y no en movimientos

La primera versión del verificador comparaba el total de `stock.move` del
día. Más allá del bug de zona horaria de arriba, la cifra no sirve ni bien
calculada: **la tienda genera movimientos todo el día**. Solo entre el 3 y
el 5 de septiembre hubo 249, casi todos ventas de POS y recepciones de
mercancía. Un verificador que exija "cero movimientos" da FALLO en cualquier
día hábil, por razones ajenas a Utilia.

La señal correcta es el **ajuste de inventario**: es lo único que Utilia
crearía si la barrera fallara, y una venta o una entrada no lo llevan. El
catálogo registra 7.762 ajustes históricos —el negocio corrige inventario a
mano con regularidad, 18 solo en septiembre— y cero en las corridas del
verificador corregido.

**Limitación conocida:** la API de Utilia autentica con la misma cuenta de
Odoo que usa el POS (uid 2), así que `create_uid` no distingue un ajuste
hecho por la app de uno hecho a mano. Si una corrida futura reporta ajustes
nuevos, hay que mirarlos en Odoo antes de concluir nada. La garantía dura no
la da este script sino la lista blanca de `write-guard.ts`, que no puede
emitir un campo de inventario, y su prueba unitaria — verificada borrando la
llamada a `assertWritable` y comprobando que la prueba falla.
