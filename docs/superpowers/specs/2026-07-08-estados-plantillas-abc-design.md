# Plantillas A/B/C para los Estados de WhatsApp — Design Spec

**Fecha:** 2026-07-08
**Origen:** En el brainstorming inicial de "Estados de hoy" se diseñaron 3 estilos de estado (A/B/C) pero solo se implementó A. El usuario quiere poder elegir cualquiera de las 3 plantillas por estado y que la imagen se construya con esa plantilla.

## Problema

La ruta generadora `/api/estados/[id]` dibuja una única composición (estilo A). Los estilos B ("banda azul de marca") y C ("limpio/editorial"), que ya fueron validados como mockups, no existen en el generador. El operador no puede variar el look de sus estados.

## Objetivo

Permitir elegir, **por estado**, una de tres plantillas visuales (A/B/C); al elegir, la imagen del estado se reconstruye con esa plantilla.

## Alcance

- Selección **por estado** (cada una de las 3 tarjetas del día tiene su propio A/B/C). La plantilla se persiste en cada `StatusPost`.
- Default **A** para estados nuevos.
- Implementar las composiciones B y C en `next/og` (Satori), además de la A ya existente.

Fuera de alcance: plantilla global/preferencia, editor libre de plantillas, plantillas nuevas más allá de A/B/C, cambio de los colores o el logo de marca.

## Las tres plantillas

Formato común **1080×1920** (9:16). Colores de marca: azul `#0851D4`, verde lima `#82FE28`. Foto real del producto (WebP de Odoo → PNG con sharp) y logo `public/logo Utilia.jpg`. Todas muestran los mismos datos: logo, sello de descuento, nombre, precio anterior tachado, precio final, y el copy de urgencia.

- **A — Impacto máximo (existente):** foto a sangre completa; degradado oscuro inferior; logo en badge blanco arriba-izq; sello verde circular del % arriba-der; bloque inferior con nombre, precio anterior tachado, precio final grande en verde lima, y pill de copy sobre azul.
- **B — Banda azul de marca:** foto ocupa la parte superior (~56%); banda azul (`#0851D4`) inferior (~44%) con: sello verde del % montado sobre el borde, nombre, precios (anterior tachado + final en verde lima) y el copy. Logo en badge blanco arriba-izq sobre la foto.
- **C — Limpio/editorial:** fondo blanco; foto enmarcada con margen en la mitad superior (esquinas redondeadas); fila con logo + etiqueta "LIQUIDACIÓN" en azul; nombre en negro; fila con precio (anterior tachado gris + final grande en azul) a la izquierda y pill verde del % a la derecha; pie con el copy en azul.

## Arquitectura

### 1. Modelo — `prisma/schema.prisma`

Agregar a `StatusPost`:

```prisma
  template String @default("A")   // "A" | "B" | "C"
```

Se aplica con SQL directo (misma restricción de `prisma db push` documentada en el spec anterior: FK cross-schema de la DB compartida). SQL: `ALTER TABLE "StatusPost" ADD COLUMN "template" TEXT NOT NULL DEFAULT 'A';` seguido de `prisma generate`.

### 2. Renderers de plantilla — `src/app/api/estados/[id]/templates.tsx`

Módulo nuevo que aísla las 3 composiciones de la ruta. Exporta:

```tsx
export type TemplateId = "A" | "B" | "C";

export interface EstadoData {
  productName: string;
  salePrice: number;
  finalPrice: number;
  discountPct: number;
  copy: string;
  photoSrc: string | null; // data URI PNG, o null → fondo de marca
  logoSrc: string;         // data URI del logo
}

export function renderEstado(template: TemplateId, d: EstadoData): React.ReactElement;
```

Internamente `renderEstado` despacha a `TemplateA(d)`, `TemplateB(d)`, `TemplateC(d)` (funciones que devuelven el JSX de Satori). Helpers compartidos (`fmtCOP`, colores) viven en este módulo. Cada plantilla usa solo CSS soportado por Satori (flexbox, position absolute, linear-gradient, border-radius, transform rotate, textDecoration).

### 3. Ruta — `src/app/api/estados/[id]/route.tsx`

Se adelgaza: busca el `StatusPost`, prepara `photoSrc` (WebP→PNG con sharp, con fallback) y `logoSrc`, valida `post.template` (si no es A/B/C → "A") y devuelve `new ImageResponse(renderEstado(template, data), { width: 1080, height: 1920 })`.

### 4. Lógica — `src/lib/analytics/status-posts.ts`

```ts
export async function updateStatusPostTemplate(id: string, template: "A" | "B" | "C"): Promise<StatusPost>
```

Actualiza `template` (y por ende `updatedAt`, lo que sirve de cache-bust de la imagen). La creación de estados no cambia: el default "A" lo da el schema.

### 5. Server action — `src/app/(dashboard)/campanas/status-actions.ts`

```ts
export async function setTemplateAction(id: string, template: string)
```

Valida `template ∈ {A,B,C}` (si no, error), llama `updateStatusPostTemplate`, `revalidatePath("/campanas")`, retorna `{ ok }` con el patrón existente.

### 6. UI — `src/components/dashboard/StatusPostsToday.tsx`

- `StatusPostView` suma `template: "A" | "B" | "C"`.
- Cada tarjeta muestra un grupo de 3 botones **A / B / C** (el activo resaltado con los colores de marca). Al hacer clic: `run(() => setTemplateAction(post.id, "B"), "Plantilla cambiada")`, que refresca; el `<img src={/api/estados/${id}?v=${version}}>` se recarga con la nueva plantilla porque `version` (= `updatedAt`) cambió.

### 7. Página — `src/app/(dashboard)/campanas/page.tsx`

El `map` que arma `statusView` suma `template: p.template as "A" | "B" | "C"`.

## Flujo de datos

```
Tarjeta: clic en A/B/C
  └─ setTemplateAction(id, template)         (server action)
       └─ updateStatusPostTemplate           (actualiza StatusPost.template + updatedAt)
       └─ revalidatePath("/campanas")
  └─ router.refresh() → statusView.version cambia
  └─ <img src=/api/estados/[id]?v=version>   → route.tsx
       └─ renderEstado(post.template, data)  → ImageResponse (PNG de la plantilla elegida)
```

## Manejo de errores
- `template` inválido en la ruta o la acción → se usa/valida contra "A".
- Foto/Odoo/IA: sin cambios respecto al comportamiento actual (fallback de marca, etc.), compartido por las 3 plantillas.

## Testing
- `npx tsc --noEmit` limpio.
- Verificación en preview: para un mismo `StatusPost`, renderizar `/api/estados/[id]` tras fijar `template` en A, B y C, y capturar screenshot de las 3 para confirmar que B y C (nuevas en Satori) se ven correctas y fieles a los mockups.
