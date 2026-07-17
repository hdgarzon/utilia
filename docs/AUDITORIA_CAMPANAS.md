# Auditoría — Módulo Campañas / Estados de WhatsApp

**Fecha:** 2026-07-17 · **Rama:** `feat/estados-plantillas-abc` · **Fase 0 del plan de implementación**

---

## Resumen ejecutivo

**El diagnóstico del plan no corresponde al código actual.** El plan asume una arquitectura que no existe en este repo:

| El plan asume | La realidad del código |
|---|---|
| Generación con **canvas en el navegador** | Ya es **server-side**: `next/og` (Satori) + `sharp`, runtime nodejs |
| **2.000 productos por tanda** al navegador | El navegador recibe **1.700 filas de JSON sin imágenes** (~200 KB) |
| **160–300 MB** de imágenes al cliente | El cliente recibe **3 URLs** (`<img src="/api/estados/{id}">`), ~3 imágenes/día |
| Imágenes **base64 al cliente** | El base64 **nunca sale del servidor** |
| Hay que **migrar a sharp** | `sharp` **ya está en uso** en producción (`route.tsx:4,26`) |
| Hay que **mover credenciales al servidor** | `ODOO_API_KEY` **ya vive solo en el servidor** |

El módulo real no es un generador masivo de catálogo: es una **selección diaria de 3 productos de capital muerto** (`SLOTS = 3`, `status-posts.ts:18`) con copy generado por IA, persistida en la tabla `StatusPost`. Hay **18 StatusPost históricos** en la base — no miles.

**Los principios "no negociables" del plan ya se cumplen** (1, 3 y 5 de la sección 3). Los principios 2 y 4 (paginación y caché) sí señalan problemas reales, pero de una magnitud muy distinta a la descrita.

> **Recomendación:** no ejecutar las Fases 1–2 tal como están escritas. Construirían una segunda capa de caché e infraestructura (Supabase Storage, sync job, grilla virtualizada) para resolver un cuello de botella que no existe. Los problemas reales que sí encontré son bastante más pequeños y están listados abajo.

---

## Mapa de archivos

### Flujo actual (extremo a extremo)

```
Odoo 19 ──JSON-RPC──▶ src/lib/sync.ts ──▶ Postgres (Supabase) tabla ProductInsight
                                                    │
                                                    ▼
                              src/lib/analytics/status-posts.ts
                              (elige 3/día por capital invertido + copy IA)
                                                    │
                                                    ▼
                                          tabla StatusPost
                                                    │
                                                    ▼
                     src/app/(dashboard)/campanas/page.tsx  (RSC)
                                                    │
                                                    ▼
                 src/components/dashboard/StatusPostsToday.tsx  (cliente)
                                   <img src="/api/estados/{id}?v={version}">
                                                    │
                                                    ▼
                     src/app/api/estados/[id]/route.tsx   ← generación server-side
                       Odoo image_1920 → sharp → PNG → Satori → 1080×1920
                                                    │
                                                    ▼
                       src/app/api/estados/[id]/templates.tsx  (plantillas A/B/C)
```

### Archivos involucrados

| Archivo | Líneas | Rol |
|---|---|---|
| `src/lib/odoo.ts` | 452 | Cliente JSON-RPC de Odoo (auth, `getProducts`, `getProductImage`) |
| `src/lib/sync.ts` | ~700 | Sync Odoo → Prisma, con `SyncState.lastSyncAt` |
| `src/lib/analytics/status-posts.ts` | 302 | Selección diaria, copy IA, edición de estados |
| `src/app/api/estados/[id]/route.tsx` | 47 | **Generación de la imagen (server-side)** |
| `src/app/api/estados/[id]/templates.tsx` | 119 | Plantillas visuales A/B/C, 1080×1920 |
| `src/app/(dashboard)/campanas/page.tsx` | 142 | RSC: stats + pools + StatusPostsToday |
| `src/components/dashboard/StatusPostsToday.tsx` | 217 | UI cliente: preview, descarga, edición |
| `src/app/(dashboard)/campanas/status-actions.ts` | 74 | Server actions (copy, descuento, plantilla, producto) |

---

## Checklist de supuestos del plan

- [ ] ❌ **Las imágenes llegan al cliente en base64.**
  Falso. El cliente recibe una URL: `` const imgUrl = `/api/estados/${post.id}?v=${post.version}` `` (`StatusPostsToday.tsx:48`), consumida como `<img src={imgUrl}>` (`:73`). El base64 de Odoo se decodifica y compone **dentro del servidor** (`route.tsx:22-31`) y nunca se serializa al cliente.

- [x] ✅ **Se pide `image_1920` u otra variante de alta resolución.**
  Confirmado — el único supuesto del plan que acierta de lleno. `odoo.ts:302-305` pide `image_1920` (hasta ~1920px, 1–3 MB en base64) aunque el lienzo mide 1080px de ancho. **Desperdicio real de ancho de banda y CPU**, pero server↔Odoo, no servidor↔navegador.

- [x] ⚠️ **Hay llamadas por-producto (N+1) o una sola llamada gigante sin paginar.**
  Parcial, en la segunda mitad. **No hay N+1**: se pide 1 imagen por render (3/día). **Sí hay una llamada gigante sin paginar**: `odoo.ts:278-283` usa `{ limit: 5000 }` sin `offset` ni bucle. Superados los 5.000 productos, el sync **trunca en silencio**. Hoy hay 2.301 → bug latente, no activo.

- [x] ✅ **No existe caché de imágenes entre generaciones.**
  Confirmado, y es **el hallazgo más accionable**. Cada `GET /api/estados/[id]` re-ejecuta el pipeline completo: JSON-RPC a Odoo (`image_1920`) → `sharp` → PNG → Satori. Sin `Cache-Control`, sin almacenamiento. Recargar la página regenera las 3 imágenes desde cero. Irónicamente el `?v={updatedAt}` (`StatusPostsToday.tsx:48`, `page.tsx:67`) **ya es una clave de caché por versión perfecta** — solo que nadie la aprovecha.

- [ ] ❌ **Las descargas son secuenciales (await en bucle).**
  Falso para imágenes (una por request). **Pero sí hay un bucle secuencial de IA**: `status-posts.ts:204-211` hace `for` con `await createPostFromCandidate`, y cada iteración llama a OpenAI (`:158`). Son 3 llamadas en serie, una vez al día. Impacto bajo.

- [ ] ❌ **Ya existe cliente de Supabase configurado (¿storage habilitado?).**
  **No hay cliente de Supabase.** `@supabase/supabase-js` no está instalado. Supabase aparece solo de dos formas: (a) hospeda el Postgres al que Prisma se conecta vía `DATABASE_URL`, y (b) un RPC de auth por `fetch` crudo (`auth.ts:10-19`). **Storage no está habilitado ni usado.** El `*.supabase.co` en `next.config.ts:9` es un `remotePattern` sin uso real.

- [x] ✅ **Versión exacta de Next.js (App Router vs Pages) y si hay RSC.**
  **Next.js 15.5.18** (`package.json` declara `^15.3.2`), **App Router** con route groups `(dashboard)` / `(auth)`, **React 19.1**. RSC sí: `page.tsx` es async server component; `StatusPostsToday.tsx` es cliente. Server Actions en uso (`status-actions.ts`).

---

## Cuellos de botella reales (con evidencia)

Ordenados por relación impacto/esfuerzo.

### 1. Cero caché en la generación de imágenes · `route.tsx:15-46`
Cada request rehace todo el pipeline. La respuesta sale sin `Cache-Control`, así que ni el navegador ni la CDN de Vercel la retienen.
**Arreglo:** añadir `Cache-Control: public, max-age=31536000, immutable`. La URL ya está versionada con `?v={updatedAt}`, así que un cambio de descuento/plantilla invalida solo. Es un one-liner que elimina prácticamente todo el trabajo repetido.

### 2. ~~`image_1920` para un lienzo de 1080px~~ · **CORREGIDO — esta recomendación era errónea**
> **Retractación (2026-07-17).** Al implementarlo verifiqué cómo se dibuja la foto en cada plantilla y **bajar a `image_1024` habría degradado la plantilla A**. A es full-bleed: `1080×1920` con `objectFit: cover`, así que una foto cuadrada de 1024 px tendría que escalar **1,875×** para cubrir el lienzo — degradación visible. B (`1080×1075`) y C (`968×1000`) sí tolerarían 1024, pero no justifica ramificar por plantilla.
>
> Además, **el arreglo #1 vuelve el problema irrelevante**: con `Cache-Control` cada imagen se baja de Odoo una vez por versión, así que el ahorro de ancho de banda era mínimo y el costo de calidad real. **Se mantiene `image_1920`.**

### 3. `getProducts` sin paginación · `odoo.ts:278-283`
`{ limit: 5000 }` sin `offset`. Con 2.301 productos hoy funciona; al superar 5.000 el sync trunca sin avisar.
**Arreglo:** bucle con `offset` en lotes de 200–500. Esto **sí** es el principio 2 del plan, y vale la pena hacerlo.

### 4. `sharp` no declarado en `package.json` ⚠️
`route.tsx:4` importa `sharp` y funciona solo porque Next lo arrastra como dependencia transitiva (`sharp@0.34.5` resuelto). Si Next cambia su árbol de dependencias, **producción se rompe sin que ningún cambio nuestro lo explique**.
**Arreglo:** `npm i sharp` para declararlo explícitamente. Riesgo latente, arreglo trivial.

### 5. `.env.example` incompleto — un dev nuevo no puede levantar el proyecto
Faltan 4 variables que el código exige:

| Variable | Requerida en | ¿En `.env.example`? |
|---|---|---|
| `ODOO_LOGIN` | `odoo.ts:13` (auth falla sin ella) | ❌ |
| `DIRECT_URL` | `prisma/schema.prisma:8` | ❌ |
| `NEXT_PUBLIC_SUPABASE_URL` | `auth.ts:10` | ❌ |
| `SUPABASE_ANON_KEY` | `auth.ts:11` | ❌ |

### 6. 1.700 candidatos serializados al cliente · `page.tsx:48-54`
`rankedDeadStock()` (259) + `rankedRegularStock()` (1.441) van completos como props al componente cliente. **Sin imágenes** — solo nombre, precio, stock: ~200 KB. Es lo más cercano a la queja original, y aun así el propio plan lo considera aceptable ("~200 KB, livianos"). No virtualizado, pero solo alimenta un selector.
**Nota:** ambas queries traen todas las columnas; un `select` acotado bajaría el payload sin tocar la arquitectura.

---

## Qué se recicla y qué se reemplaza

### Se recicla (mayoría del plan ya está construido)
- **`templates.tsx`** — ya hace 1080×1920, colores de marca `#0851D4`/`#82FE28` (`:15-16`), formato COP `es-CO` (`:19`), placeholder de gradiente cuando no hay foto (`:30`). Con Satori se escribe JSX, así que **`escapeXml` no aplica**: React escapa solo. Buena parte de la sección "Especificaciones visuales" del plan ya está satisfecha.
- **`route.tsx`** — el pipeline Odoo → sharp → Satori funciona; le falta caché.
- **`odoo.ts`** — cliente JSON-RPC sólido, con UID cacheado y manejo de archivados.
- **`sync.ts` + `SyncState.lastSyncAt`** — **ya existe sync incremental por `write_date`** (`odoo.ts:276`). La Fase 1 del plan lo reinventaría.
- **Modelo `StatusPost`** — cubre plantilla, descuento, copy, posted, con `@@unique([date, slot])` para idempotencia.

### Se reemplaza / se corrige
Los 6 puntos de arriba. Ninguno requiere arquitectura nueva.

### Se descarta del plan
- **Supabase Storage + caché `{product_id}-{write_date}.webp`** — resolvería un problema de escala que no existe (3 imágenes/día). `Cache-Control` sobre la URL ya versionada logra lo mismo con una línea.
- **Job de sync de imágenes con `p-limit`, backfill de 2.000, barra de progreso** — el sync de datos ya existe y es incremental. Un backfill de 2.000 imágenes serviría a un catálogo que nadie navega con fotos.
- **Grilla virtualizada (`@tanstack/react-virtual`)** — el selector no muestra imágenes; 1.700 filas de texto no justifican la dependencia.
- **La ruta/flag `campanas-v2` en paralelo** — sin reescritura, no hay qué correr en paralelo.

### ⚠️ Error técnico en la Fase 1 del plan
El plan propone descargar imágenes con:
```
GET {ODOO_URL}/web/image/product.template/{id}/image_512
Authorization: Bearer {ODOO_API_KEY}
```
**Esto no funcionaría.** El encabezado del cliente actual lo documenta explícitamente (`odoo.ts:1-9`):

> *"Odoo NO acepta `Authorization: Bearer`. Usa el endpoint /jsonrpc con: 1. service="common" + method="authenticate" → devuelve uid numérico..."*

Alguien ya chocó con esto y lo dejó escrito. Cualquier acceso a imágenes debe pasar por `execute_kw`, como hace `getProductImage`.

---

## Sobre los 4 tipos de plantilla (Fase 3)

Esta es la parte del plan que **sí agrega valor real y no existe todavía**. Las plantillas actuales A/B/C son tres variantes de "producto". El mapeo:

| Plantilla del plan | Estado |
|---|---|
| `producto` | ✅ Ya existe (A/B/C) |
| `gancho` | ❌ Nueva |
| `comparativa` | ❌ Nueva — requiere 2 productos, hoy `StatusPost` referencia 1 (`odooProductId` singular) |
| `testimonio` | ❌ Nueva — requiere subida manual de imagen, no hay storage para eso |

`comparativa` y `testimonio` sí necesitan cambios de modelo de datos. `testimonio` es el **único caso que justifica Supabase Storage** — para las fotos subidas a mano, no para el catálogo de Odoo.

---

## Propuesta de camino alternativo

Sujeto a tu aprobación — no toco código hasta que decidas.

**Paso 1 — Higiene (~1 commit, bajo riesgo).** Declarar `sharp`, completar `.env.example`, `Cache-Control` en `route.tsx`, `image_1920`→`image_1024`, paginar `getProducts`. Ataca 5 de los 6 cuellos de botella reales.

**Paso 2 — Medir antes de construir.** Con el caché puesto, cronometrar la página de Campañas. Sospecho que la lentitud real que estás viviendo viene de `getOrCreateTodayStatusPosts()` en el render (`page.tsx:49`): en la primera carga del día dispara **3 llamadas secuenciales a OpenAI** dentro del RSC, con `force-dynamic` (`page.tsx:1`) y sin streaming. Eso bloquea la página entera varios segundos — y ninguna de las Fases 1–3 del plan lo arreglaría.

**Paso 3 — Plantillas nuevas.** `gancho` primero (no necesita cambios de modelo). Luego `comparativa` (+ modelo) y `testimonio` (+ storage), si siguen valiendo la pena en uso real.

---

## Pregunta abierta

El plan describe **10–30 estados/día**; el código impone **3/slot fijos** (`SLOTS = 3`). ¿La meta es subir a 10–30 estados diarios? Eso cambiaría la prioridad de varias cosas — si vas a 30/día con regeneraciones frecuentes, el caché pasa de "bueno" a "imprescindible", y `comparativa` gana peso. Pero incluso 30 estados/día quedan muy lejos de necesitar Supabase Storage para el catálogo.
