# Módulo de Reabastecimiento — Design Spec

**Fecha:** 2026-08-31
**Origen:** El flujo de compra de inventario es manual de punta a punta: revisar en el software qué falta, armar la lista, contactar al proveedor (WhatsApp o visita del vendedor) y, cuando llega la mercancía, digitar la compra en Odoo producto por producto. El dueño quiere automatizar lo máximo posible de ese ciclo.

## Problema

1. **Detección:** Inventario clasifica críticos/advertencia y Compras genera el plan OTB, pero el OTB llega solo a nivel *categoría*. Traducir "N productos críticos" a "pídele X unidades de estas referencias al proveedor Y" es trabajo mental manual.
2. **Contacto:** el sistema no sabe qué proveedor surte cada producto. La lista para el proveedor se arma a mano.
3. **Registro de llegada:** hoy no se registra nada en Odoo al pedir; al llegar la mercancía se digita la compra producto por producto. Es el paso más costoso en tiempo y errores.

## Objetivo

Que el ciclo quede así: abrir `/reabastecimiento` → revisar el pedido sugerido por proveedor (ajustar cantidades si hace falta) → **Aprobar** (crea la orden de compra en borrador en Odoo) → **WhatsApp** (mensaje del pedido ya redactado) → al llegar la mercancía, confirmar la orden y validar la recepción en Odoo (2–3 clics, cero digitación). Utilia cierra el ciclo sola con el sync diario.

## Alcance

- Motor de sugerencias de compra **por producto**, agrupado **por proveedor**.
- Inferencia del proveedor habitual por producto desde el historial de `PurchaseOrder` ya sincronizado, con asignación manual persistente para productos sin historial.
- Directorio de proveedores (nombre, vínculo a Odoo, WhatsApp editable).
- Página `/reabastecimiento` con tarjetas por proveedor, cantidades editables, mensaje de WhatsApp con un clic y aprobación que crea `purchase.order` **en borrador** en Odoo.
- Seguimiento del ciclo (Aprobado → Enviado → Recibido) cerrado automáticamente por el sync.
- Alerta de pedidos enviados sin recibir después de 7 días.

**Fuera de alcance (v1):** creación de productos nuevos en Odoo, tiempos de entrega y mínimos de pedido por proveedor, precios reales del proveedor (se usa el CMP como estimado), envío automático de mensajes (360dialog) y recepción automática. La regla general del repo se mantiene: el sync jamás escribe en Odoo; la única escritura es la creación del borrador por acción explícita del usuario.

## Reglas de negocio (alineadas con el plan de crecimiento)

- **Candidatos a pedido:** productos con venta reciente (`avgDailySales7d > 0`), stock no negativo, categoría no-servicio y — cualquiera de las dos — cobertura `daysOfStock < 14` (mismos umbrales crítico `<7` / advertencia `7–14` de Inventario) **o** `stockQty < minStock`.
- **Cantidad sugerida:** `ceil(max(velocidad7d × coberturaObjetivo − stockQty, minStock − stockQty))`, con `coberturaObjetivo` = 21 días por defecto (selector 14/21/30/45 como en Compras) y piso en 0.
- **Regla dura de no-recompra:** ningún producto con `rotationDays > 45` entra a las sugerencias, tenga el stock que tenga.
- **Prioridad A/B:** cada línea se etiqueta con su tier ABC (`getABCAnalysis`). Las líneas C se muestran en una sección aparte ("evalúa si vale la pena") y no se preseleccionan.
- **Disciplina OTB:** el total estimado de todos los pedidos se compara contra el Fondo de Reposición (`getOpenToBuyPlan`) y se muestra la brecha, igual que en Compras.

## Arquitectura

### 1. Modelo — `prisma/schema.prisma`

```prisma
model Supplier {
  id            String   @id @default(cuid())
  name          String   @unique          // matchea PurchaseOrder.partnerName
  odooPartnerId Int?     @unique          // necesario para crear la orden en Odoo
  phone         String?                   // WhatsApp, editable en UI
  notes         String?
  active        Boolean  @default(true)
  orders        ReplenishmentOrder[]
  overrides     ProductSupplierOverride[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

// Asignación manual producto→proveedor para referencias sin historial de compra.
// La inferencia por historial NO se materializa aquí; esto es solo el override.
model ProductSupplierOverride {
  odooProductId Int      @id
  supplier      Supplier @relation(fields: [supplierId], references: [id])
  supplierId    String
  createdAt     DateTime @default(now())
}

model ReplenishmentOrder {
  id             String              @id @default(cuid())
  supplier       Supplier            @relation(fields: [supplierId], references: [id])
  supplierId     String
  status         ReplenishmentStatus @default(APPROVED)
  odooOrderId    Int?                @unique // purchase.order creado en borrador
  odooOrderName  String?             // ej "P00123"
  totalEstimated Float               @default(0) // suma qty × unitCost al aprobar
  sentAt         DateTime?           // clic en WhatsApp / marcado manual
  receivedAt     DateTime?           // detectado por el sync
  lines          ReplenishmentLine[]
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  @@index([status])
}

enum ReplenishmentStatus {
  APPROVED   // aprobado en Utilia; borrador creado (o pendiente de crear) en Odoo
  SENT       // pedido enviado al proveedor
  RECEIVED   // orden confirmada/recibida en Odoo (la detecta el sync)
  CANCELLED
}

model ReplenishmentLine {
  id            String             @id @default(cuid())
  order         ReplenishmentOrder @relation(fields: [orderId], references: [id], onDelete: Cascade)
  orderId       String
  odooProductId Int
  productName   String
  qty           Float  // cantidad final aprobada por el usuario
  suggestedQty  Float  // lo que sugirió el motor (para comparar después)
  unitCost      Float  // CMP al momento de aprobar
  reason        String // "critico" | "advertencia" | "min_stock"

  @@index([orderId])
  @@index([odooProductId])
}
```

Además, `PurchaseOrder` gana `odooPartnerId Int?` (hoy solo se guarda `partnerName`); el sync lo puebla desde `partner_id[0]` y el historial se rellena reseteando `lastSyncAt` de la entidad `purchase_order` para forzar re-sync (volumen bajo, decenas de órdenes).

Los cambios se aplican con **SQL directo + `prisma generate`** (restricción documentada de la BD compartida: `prisma db push` tropieza con la FK cross-schema), siguiendo el patrón de los specs anteriores.

### 2. Motor de sugerencias — `src/lib/analytics/replenishment.ts`

```ts
export interface ReplenishmentSuggestion {
  supplier: { id: string | null; name: string; phone: string | null; odooPartnerId: number | null } | null; // null = "sin proveedor"
  lines: Array<{
    odooProductId: number;
    name: string;
    category: string | null;
    stockQty: number;
    daysOfStock: number;
    avgDailySales7d: number;
    suggestedQty: number;
    unitCost: number;        // cmp
    tier: "A" | "B" | "C";
    reason: "critico" | "advertencia" | "min_stock";
  }>;
  totalEstimated: number;
}

export interface ReplenishmentPlan {
  coverageDaysTarget: number;
  suggestions: ReplenishmentSuggestion[];   // una por proveedor, ordenadas por total desc
  unassigned: ReplenishmentSuggestion;      // grupo "sin proveedor"
  totals: { lines: number; estimated: number; reinvestmentFund: number; gap: number };
  pending: PendingOrder[];                  // pedidos APPROVED/SENT con días transcurridos
}
```

`getReplenishmentPlan(coverageDaysTarget = 21)`:

1. Trae candidatos de `ProductInsight` con las reglas de negocio (filtros arriba).
2. Excluye productos con líneas en pedidos abiertos (`ReplenishmentOrder.status IN (APPROVED, SENT)`) para no sugerir dos veces lo mismo mientras está en camino.
3. Resuelve proveedor por producto: primero `ProductSupplierOverride`; si no hay, el proveedor de la compra más reciente que incluyó ese producto (`DISTINCT ON (odooProductId) … ORDER BY dateOrder DESC` sobre `PurchaseOrderLine ⋈ PurchaseOrder`); si no hay historial → grupo "sin proveedor".
4. Etiqueta tiers con `getABCAnalysis()` y calcula cantidades y costos.
5. Compara el total contra `reinvestmentFund` de `getOpenToBuyPlan`.

Las sugerencias se calculan **en vivo al cargar la página** (nunca se persisten como borrador); solo la aprobación crea filas. Así no hay sugerencias viejas que mantener.

### 3. Escritura a Odoo — `src/lib/odoo-write.ts` (módulo nuevo)

Separado de `odoo.ts` a propósito, con el contrato documentado en el encabezado: **solo se invoca desde server actions disparadas por el usuario; ningún job de sync ni cron lo importa.**

```ts
export async function createDraftPurchaseOrder(input: {
  odooPartnerId: number;
  originRef: string; // "UTILIA-REP-<id>" — trazabilidad en el campo origin
  lines: Array<{ odooProductId: number; qty: number; priceUnit: number }>;
}): Promise<{ odooOrderId: number; odooOrderName: string }>
```

- `executeKw("purchase.order", "create", [{ partner_id, origin, order_line: [[0, 0, { product_id, product_qty, price_unit }]] }])`, luego un `read` del `name` asignado ("P00xxx").
- `price_unit` = CMP (estimado honesto; el precio real se ajusta en Odoo al confirmar si cambió).
- El borrador (`state = "draft"`) es inofensivo: no toca stock, gasto ni contabilidad, y **el sync actual lo ignora** (solo trae `purchase`/`done`), así que no se duplica el gasto real. Se puede cancelar en Odoo sin consecuencias.
- Requisito operativo: la API key de Odoo debe tener permisos de creación en Compras (verificar una vez creando y cancelando un borrador de prueba).

### 4. Server actions — `src/app/(dashboard)/reabastecimiento/actions.ts`

- `approveOrder(supplierId, coverage, lines)`: valida sesión y datos; crea `ReplenishmentOrder(APPROVED)` + líneas en una transacción; llama `createDraftPurchaseOrder`; guarda `odooOrderId/odooOrderName`. **Idempotencia:** si la creación en Odoo falla, la fila queda con `odooOrderId = null` y la UI ofrece "Reintentar creación en Odoo" (reintenta solo la llamada RPC, no duplica el pedido); si ya tiene `odooOrderId`, no se vuelve a crear.
- `markSent(orderId)`: sella `sentAt` y pasa a `SENT` (se dispara al hacer clic en el botón de WhatsApp, con opción de marcarlo manual para pedidos tomados por el vendedor en visita).
- `cancelOrder(orderId)`: pasa a `CANCELLED` (la cancelación del borrador en Odoo, si existe, se hace en Odoo; la UI muestra el nombre de la orden para ubicarla).
- `assignSupplier(odooProductId, supplierId)`: upsert de `ProductSupplierOverride`.
- `saveSupplier({ id?, name, phone, odooPartnerId? })`: crear/editar proveedor.
- `importSuppliersFromOdoo()`: lectura nueva `odoo.getSuppliers()` (`res.partner` con `supplier_rank > 0`, campos `id/name/phone/mobile`) que precarga el directorio; también se crean proveedores automáticamente al inferirlos del historial (con su `odooPartnerId` ya resuelto).

### 5. Página — `src/app/(dashboard)/reabastecimiento/page.tsx`

- **KPIs:** productos críticos / advertencia en el plan, total estimado vs Fondo de Reposición (con brecha), pedidos en curso. Selector de cobertura objetivo 14/21/30/45 días (mismo patrón visual de Compras, vía query param).
- **Tarjeta por proveedor:** líneas con producto, stock, días de cobertura, velocidad, tier ABC, cantidad editable (input numérico, default = sugerida), costo estimado y total de la tarjeta. Acciones: **Aprobar y crear en Odoo**, **WhatsApp** (`https://wa.me/<phone>?text=<pedido urlencoded>` — se habilita tras aprobar; si el proveedor no tiene teléfono, pide capturarlo ahí mismo), **Descartar**. Sección colapsable "clase C — evalúa si vale la pena".
- **Grupo "sin proveedor":** mismas líneas con selector de proveedor inline (o crear proveedor nuevo); al asignar, las líneas se mueven a la tarjeta correspondiente.
- **Pedidos en curso:** órdenes `APPROVED`/`SENT` con proveedor, total, nombre de la orden en Odoo, días transcurridos desde `sentAt` y badge de alerta si `> 7 días` sin recibir.
- Mensaje de WhatsApp (texto plano, sin datos sensibles más allá del pedido): saludo con nombre del proveedor, lista `• {qty} × {producto}`, y cierre pidiendo confirmación de disponibilidad y fecha de entrega. El teléfono se normaliza a formato internacional (57…).
- Mobile-first: la misma vista es la lista de chequeo cuando el vendedor visita la tienda.
- Navegación: entrada en el sidebar + enlaces desde Inventario ("Generar pedido") y Compras.

### 6. Cierre del ciclo — extensión de `syncPurchases` (`src/lib/sync.ts`)

Tras upsertar las órdenes confirmadas de Odoo, un paso adicional de solo-BD:

```sql
UPDATE "ReplenishmentOrder" r
SET status = 'RECEIVED', "receivedAt" = p."dateOrder"
FROM "PurchaseOrder" p
WHERE p."odooOrderId" = r."odooOrderId"
  AND r.status IN ('APPROVED', 'SENT')
```

Limitación documentada: en Odoo, "confirmada" (`purchase`) no siempre implica "recibida" (picking validado); en la operación real de la tienda ambas cosas ocurren en el mismo momento (al llegar la mercancía), así que `state ∈ {purchase, done}` es señal suficiente de recepción para v1.

## Manejo de errores

- Fallo RPC al crear el borrador → el pedido queda `APPROVED` sin `odooOrderId`, con aviso y botón de reintento; nunca se pierde lo aprobado ni se crean duplicados.
- Proveedor sin `odooPartnerId` → se puede aprobar el pedido en Utilia y enviar el WhatsApp, pero el botón de Odoo queda deshabilitado con aviso "vincula este proveedor a Odoo" (selector de partner sugerido por nombre).
- Productos archivados en Odoo dentro de una sugerencia → se filtran de la creación del borrador con nota en la tarjeta.
- El paso nuevo del sync es tolerante: si falla, no rompe `syncPurchases` (mismo patrón de estados por entidad ya usado).

## Pruebas

- **Motor:** casos unitarios de las reglas con datos fake (`Producto Demo`, CMPs redondos): umbral de cobertura, `minStock`, exclusión por `rotationDays > 45`, exclusión de pedidos abiertos, resolución override > historial > sin proveedor.
- **Odoo write:** prueba manual controlada — crear un borrador con 1 línea, verificar en Odoo (partner, cantidades, `origin`), cancelarlo. Confirmar que el sync no lo ingiere mientras es borrador.
- **Ciclo completo:** aprobar → confirmar en Odoo → correr `npm run sync` → verificar `RECEIVED` y stock actualizado.
- **Regresión:** `npm run build` + lint; el sync existente no cambia de contrato (solo agrega columna y paso).

## Fases

1. **F1 — Sugerencias + WhatsApp:** modelo (`Supplier`, override, `ReplenishmentOrder/Line`, columna en `PurchaseOrder`), motor, página con aprobación local y WhatsApp. Ya usable sin tocar Odoo.
2. **F2 — Borrador en Odoo:** `odoo-write.ts`, integración en `approveOrder`, reintento, import de proveedores.
3. **F3 — Cierre y alertas:** extensión del sync, sección "pedidos en curso" con alerta de demora, enlaces desde Inventario/Compras y sidebar.
