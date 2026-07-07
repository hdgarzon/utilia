# Estados de WhatsApp para Liquidación de Capital Muerto — Design Spec

**Fecha:** 2026-07-07
**Origen:** Necesidad del negocio de mover rápido el inventario de capital muerto (identificado en la pantalla `/liquidacion`) publicando ofertas diarias en los Estados de WhatsApp de la tienda.

## Problema

La pantalla `/liquidacion` ya identifica y cuantifica el capital muerto (`rotationDays > 30 AND stockQty > 0`) y permite simular descuentos, pero **no genera ninguna acción de venta**. Para mover ese inventario hace falta exponerlo al cliente. El canal más directo y gratuito de la papelería son los **Estados de WhatsApp**. Hoy no existe forma de convertir un producto muerto en una pieza de oferta lista para publicar; hacerlo a mano (elegir producto, sacar foto, poner precio, diseñar) es lento y por eso no se hace.

## Objetivo

Cada día, presentar **3 estados listos para publicar** — imagen 1080×1920 con la marca Utilia, foto real del producto, precio rebajado y copy de urgencia generado por IA — para que el dueño los **descargue y suba a su Estado de WhatsApp** en segundos.

## Restricción clave: publicación asistida, no automática

**WhatsApp no ofrece ninguna API oficial para publicar Estados.** Ni el WhatsApp Business Cloud API ni proveedores como 360dialog exponen la funcionalidad de "Estado/Status". La única vía de automatización sería con librerías no oficiales (WhatsApp Web scraping / no-oficiales) que **violan los términos de servicio y arriesgan el baneo permanente del número** de la tienda.

**Decisión:** el sistema genera la imagen final lista y el dueño la publica manualmente (descargar → WhatsApp → Estado → subir). Es seguro, cumple términos, y el trabajo manual se reduce a segundos por estado. El diseño deja la puerta abierta a otros canales (ver "Extensiones futuras") sin reescribir el generador.

## Alcance

Sección nueva **"Estados de hoy"** dentro de la página `/liquidacion` (no una página de nav separada; vive junto al análisis de capital muerto del que se alimenta).

Fuera de alcance: publicación automática, programación/scheduling con cron, envío por WhatsApp API, métricas de vistas del estado (WhatsApp no las expone), edición libre del diseño.

## Reglas de negocio

### Selección de productos
- Universo: capital muerto (`rotationDays > 30 AND stockQty > 0`), reutilizando `getDeadStockAnalysis()` de `src/lib/analytics/dead-stock.ts`.
- Prioridad: **mayor `investedCapital` primero** (liberar primero la plata más congelada).
- **No repetición:** un producto no vuelve a aparecer hasta haber ciclado por toda la cola de capital muerto (se excluyen los `odooProductId` con un `StatusPost` en los últimos N días; ver modelo). Si la cola se agota, se reinicia.
- Se seleccionan **3 por día** (slots 1, 2, 3).

### Descuento escalonado (por antigüedad de rotación)
- `rotationDays > 60` → **30%**
- `rotationDays` entre 31 y 60 → **20%**
- Precio final = `round(salePrice * (1 - pct))`, redondeado a un valor "bonito" (múltiplo de 100 COP).
- **Editable por estado** antes de descargar: el dueño puede subir/bajar el % y la imagen se regenera.

### Copy (IA)
- Una línea corta de gancho/urgencia en español coloquial colombiano (ej. "🔥 ¡Últimas 3 unidades!", "Aprovecha, se acaba").
- Insumos: nombre del producto, `stockQty`, categoría, % de descuento.
- Regenerable con un botón (nueva variación).
- Reutiliza la infraestructura de IA existente en `src/lib/ai/`.

### Foto
- `image_1920` de Odoo (base64), obtenida por `odooProductId`. ~98% de cobertura.
- Fallback (~2% sin foto): tarjeta gráfica con fondo de marca (azul `#0851D4` → verde `#82FE28`) y el nombre del producto en grande.

## Diseño visual (Estilo A — "Impacto máximo")

Formato vertical **1080×1920** (9:16), validado con el dueño en el brainstorming visual.

- Foto del producto a sangre completa (full-bleed) de fondo.
- Degradado oscuro de abajo hacia arriba para legibilidad del texto.
- **Logo Utilia** (`public/logo Utilia.jpg`) en badge blanco redondeado, esquina superior izquierda.
- **Sello de descuento** circular verde lima (`#82FE28`, texto azul oscuro) rotado, esquina superior derecha: "-30%".
- Bloque inferior: nombre del producto, precio anterior tachado, **precio nuevo grande en verde lima**, y pill de urgencia (texto IA) sobre fondo azul de marca (`#0851D4`).

Colores de marca: azul `#0851D4`, verde lima `#82FE28`.

## Arquitectura

### 1. Modelo de datos — `prisma/schema.prisma`

```prisma
model StatusPost {
  id            String   @id @default(cuid())
  date          DateTime @db.Date          // día de la selección (Colombia)
  slot          Int                        // 1..3
  odooProductId Int
  productName   String
  category      String?
  stockQty      Int
  salePrice     Float                      // precio lista original
  discountPct   Float                      // 20 o 30 (o editado)
  finalPrice    Float                      // precio con descuento, redondeado
  copy          String                     // línea de urgencia (IA)
  posted        Boolean  @default(false)
  postedAt      DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([date, slot])
  @@index([odooProductId])
}
```

La foto **no se persiste** (pesa); se obtiene de Odoo en el momento de generar el PNG. Para 3 imágenes/día el costo de la llamada es despreciable.

### 2. Selección diaria — `src/lib/analytics/status-posts.ts`

```ts
// Devuelve los 3 StatusPost de HOY (Colombia). Si no existen, los crea:
// selecciona por investedCapital desc, excluye odooProductId ya usados
// en los últimos DAYS_BEFORE_REPEAT días, aplica descuento escalonado,
// genera copy con IA, persiste y devuelve.
export async function getOrCreateTodayStatusPosts(): Promise<StatusPost[]>

// Recalcula un slot: cambia de producto (siguiente en la cola) o
// regenera copy / cambia descuento.
export async function swapStatusPostProduct(id: string): Promise<StatusPost>
export async function regenerateStatusPostCopy(id: string): Promise<StatusPost>
export async function updateStatusPostDiscount(id: string, pct: number): Promise<StatusPost>
export async function markStatusPostPosted(id: string): Promise<void>
```

- `DAYS_BEFORE_REPEAT`: constante (p. ej. 14). Si tras excluir no quedan suficientes productos, se relaja el filtro (se permite repetir el más antiguo posteado).
- La selección se dispara de forma **perezosa** al abrir la página en un día nuevo (no requiere cron).

### 3. Generación de imagen — `src/app/api/estados/[id]/route.tsx`

- `GET` que devuelve un **PNG** usando `ImageResponse` de `next/og` (Satori), renderizando el Estilo A.
- Composición con flexbox/absolute (subset soportado por Satori): foto (data URI desde Odoo), degradado, logo (data URI), sello de %, textos.
- Fuentes: se bundlea una fuente bold (p. ej. Inter/Archivo) como `ArrayBuffer` para los números grandes.
- Cache: `Cache-Control` corto; la imagen depende del `StatusPost` (que puede editarse).

**Decisión — Satori vs canvas cliente:** se elige `ImageResponse` (servidor) por ser nativo de Vercel, no depender del navegador del usuario, y permitir reutilizar el mismo generador para futuros canales. Riesgo conocido: Satori soporta un subset de CSS; el Estilo A se ajusta a ese subset (sin sombras complejas ni filtros). Los efectos decorativos (rotación del sello, degradados) están soportados.

### 4. Acciones de servidor — `src/app/(dashboard)/liquidacion/status-actions.ts`

`"use server"` envolviendo las funciones de `status-posts.ts`, con `requireSession()` (patrón de `campanas/actions.ts`) y `revalidatePath("/liquidacion")`.

### 5. UI — `src/components/dashboard/StatusPostsToday.tsx`

- Client component. Muestra los 3 estados como preview del Estilo A (mismo markup del mockup, reutilizando los colores de marca).
- Por estado: botón **Descargar PNG** (link a `/api/estados/[id]`), input de **% descuento**, botón **Regenerar texto**, botón **Cambiar producto**, toggle **Marcar como publicado**.
- Encabezado con instrucción: "Descarga → WhatsApp → Estado → sube la imagen. 3 al día."
- Se integra en `src/app/(dashboard)/liquidacion/page.tsx` como una sección nueva, arriba o junto a la tabla de capital muerto.

## Flujo de datos

```
/liquidacion (page, server)
  └─ getOrCreateTodayStatusPosts()
       ├─ getDeadStockAnalysis()            (ProductInsight)
       ├─ filtra ya-posteados (StatusPost)
       ├─ descuento escalonado + IA copy    (src/lib/ai)
       └─ persiste StatusPost x3
  └─ <StatusPostsToday posts={...} />        (client)
       ├─ Descargar → GET /api/estados/[id]  → ImageResponse (foto Odoo + logo + overlays) → PNG
       ├─ Editar % / Regenerar / Cambiar → server actions → revalidate
       └─ Marcar publicado → server action
```

## Manejo de errores
- Producto sin `image_1920`: usar fallback gráfico de marca (no romper la imagen).
- IA no disponible / timeout: usar copy de plantilla por defecto según stock ("¡Últimas N unidades!" / "Oferta de liquidación").
- Odoo caído al generar PNG: devolver imagen con fallback y loguear; la página no falla.
- Menos de 3 productos de capital muerto disponibles: mostrar los que haya (1 o 2) con nota.

## Testing
- `status-posts.ts`: selección prioriza por capital, excluye ya-posteados, descuento escalonado correcto (>60 → 30, 31–60 → 20), redondeo de precio, reinicio de cola cuando se agota.
- Ruta de imagen: responde 200 PNG con producto válido; usa fallback sin foto.
- Verificación manual en preview: abrir `/liquidacion`, ver 3 estados, descargar uno y confirmar el PNG 1080×1920 con logo, foto, precio y sello.

## Extensiones futuras (fuera de alcance)
- Generación programada por cron (Vercel Cron) para tener los estados listos a una hora fija.
- Recordatorio/notificación a la hora de publicar.
- Reutilizar el generador de imagen para enviar por otros canales.
- Métricas de qué productos se movieron tras publicarse (cruce con ventas POS posteriores).
```
