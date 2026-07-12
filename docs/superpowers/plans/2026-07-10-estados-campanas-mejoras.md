# Mejoras a "Estados de hoy" en Campañas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar las 4 mejoras aprobadas a "Estados de hoy" en `/campanas`: ocultar la insignia de descuento cuando es 0%, un selector manual de producto (pestañas Liquidación/Regulares) que reemplaza el botón "Cambiar" aleatorio, un logo más visible en las 3 plantillas, y un indicador de carga (overlay + spinner) mientras se aplican cambios.

**Architecture:** Las plantillas Satori (`templates.tsx`) ganan condicionales de descuento y badges de logo más grandes. La capa de datos (`status-posts.ts`) gana `rankedRegularStock()` (complemento de `rankedDeadStock()`) y `pickStatusPostProduct()`, que decide el modo (liquidación/regular) por el `rotationDays` real del producto elegido, no por lo que mande el cliente; el copy IA usa un system prompt distinto según el modo. Una nueva server action (`pickProductAction`) expone eso a un diálogo cliente (`ProductPickerDialog.tsx`) construido sobre un `Dialog` de shadcn (nuevo) y el `Tabs` que ya existe. La tarjeta (`StatusPostsToday.tsx`) reemplaza "Cambiar" por "Elegir producto" y suma overlay+spinner de carga por acción.

**Tech Stack:** Next.js 15 (Server Components/Actions), Prisma 6 + Postgres, React 19, Tailwind, shadcn/ui (paquete unificado `radix-ui`), sonner, lucide-react, AI SDK (`generateObject`).

**Base:** Continúa sobre la rama `feat/estados-plantillas-abc`. Sin framework de tests en el repo; verificación con `npx tsc --noEmit` + preview manual, mismo patrón que el plan anterior de plantillas A/B/C.

---

## File Structure

- Modify: `src/app/api/estados/[id]/templates.tsx` — condicional de descuento (Tarea 1) + logos más grandes (Tarea 2).
- Modify: `src/lib/analytics/status-posts.ts` — `rankedDeadStock` exportada, `rankedRegularStock`, copy con modo, `pickStatusPostProduct` (Tarea 3); elimina `swapStatusPostProduct` (Tarea 7).
- Modify: `src/app/(dashboard)/campanas/status-actions.ts` — `pickProductAction` (Tarea 4); elimina `swapProductAction` (Tarea 7).
- Create: `src/components/ui/dialog.tsx` — vía CLI de shadcn (Tarea 5).
- Create: `src/components/dashboard/ProductPickerDialog.tsx` — diálogo con pestañas Liquidación/Regulares (Tarea 6).
- Modify: `src/components/dashboard/StatusPostsToday.tsx` — reemplaza "Cambiar" por el picker (Tarea 7); overlay + spinners (Tarea 8).
- Modify: `src/app/(dashboard)/campanas/page.tsx` — carga los pools y los pasa a `StatusPostsToday` (Tarea 7).

---

## Task 1: Ocultar insignia de descuento en 0%

**Files:** Modify `src/app/api/estados/[id]/templates.tsx`

- [ ] **Step 1: Envolver el sello de la Plantilla A en un condicional**

En `TemplateA`, reemplaza:

```tsx
      <div style={{ position: "absolute", top: "56px", right: "56px", width: "220px", height: "220px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: GREEN, borderRadius: "110px", transform: "rotate(8deg)" }}>
        <div style={{ display: "flex", fontSize: "84px", fontWeight: 800, color: "#0a2e00" }}>-{Math.round(d.discountPct)}%</div>
      </div>
```

por:

```tsx
      {d.discountPct > 0 && (
        <div style={{ position: "absolute", top: "56px", right: "56px", width: "220px", height: "220px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: GREEN, borderRadius: "110px", transform: "rotate(8deg)" }}>
          <div style={{ display: "flex", fontSize: "84px", fontWeight: 800, color: "#0a2e00" }}>-{Math.round(d.discountPct)}%</div>
        </div>
      )}
```

- [ ] **Step 2: Envolver la pill de la Plantilla B en un condicional**

En `TemplateB`, reemplaza:

```tsx
      <div style={{ position: "absolute", top: "1000px", left: "72px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: GREEN, color: "#0a2e00", fontSize: "56px", fontWeight: 800, padding: "18px 40px", borderRadius: "20px", transform: "rotate(-4deg)" }}>-{Math.round(d.discountPct)}% HOY</div>
```

por:

```tsx
      {d.discountPct > 0 && (
        <div style={{ position: "absolute", top: "1000px", left: "72px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: GREEN, color: "#0a2e00", fontSize: "56px", fontWeight: 800, padding: "18px 40px", borderRadius: "20px", transform: "rotate(-4deg)" }}>-{Math.round(d.discountPct)}% HOY</div>
      )}
```

- [ ] **Step 3: Ajustar la fila de precio+descuento de la Plantilla C**

En `TemplateC`, reemplaza:

```tsx
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: "40px", color: "#9ca3af", textDecoration: "line-through" }}>{fmtCOP(d.salePrice)}</div>
            <div style={{ display: "flex", fontSize: "120px", fontWeight: 800, color: BLUE, lineHeight: 1 }}>{fmtCOP(d.finalPrice)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: GREEN, color: "#0a2e00", fontSize: "56px", fontWeight: 900, padding: "16px 32px", borderRadius: "20px" }}>-{Math.round(d.discountPct)}%</div>
        </div>
```

por:

```tsx
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: d.discountPct > 0 ? "space-between" : "flex-start", marginTop: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: "40px", color: "#9ca3af", textDecoration: "line-through" }}>{fmtCOP(d.salePrice)}</div>
            <div style={{ display: "flex", fontSize: "120px", fontWeight: 800, color: BLUE, lineHeight: 1 }}>{fmtCOP(d.finalPrice)}</div>
          </div>
          {d.discountPct > 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: GREEN, color: "#0a2e00", fontSize: "56px", fontWeight: 900, padding: "16px 32px", borderRadius: "20px" }}>-{Math.round(d.discountPct)}%</div>
          )}
        </div>
```

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/estados/[id]/templates.tsx"
git commit -m "feat(estados): ocultar insignia de descuento cuando es 0%"
```

---

## Task 2: Logo más visible en las 3 plantillas

**Files:** Modify `src/app/api/estados/[id]/templates.tsx`

- [ ] **Step 1: Agrandar el badge de logo en la Plantilla A**

En `TemplateA`, reemplaza:

```tsx
      <div style={{ position: "absolute", top: "48px", left: "48px", width: "200px", height: "200px", display: "flex", backgroundColor: "#fff", borderRadius: "32px", padding: "12px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.logoSrc} width={176} height={176} style={{ width: "176px", height: "176px", objectFit: "contain" }} alt="Utilia" />
      </div>
```

por:

```tsx
      <div style={{ position: "absolute", top: "48px", left: "48px", width: "240px", height: "240px", display: "flex", backgroundColor: "#fff", borderRadius: "36px", padding: "15px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.logoSrc} width={210} height={210} style={{ width: "210px", height: "210px", objectFit: "contain" }} alt="Utilia" />
      </div>
```

- [ ] **Step 2: Agrandar el badge de logo en la Plantilla B**

En `TemplateB`, reemplaza:

```tsx
      <div style={{ position: "absolute", top: "48px", left: "48px", width: "210px", height: "210px", display: "flex", backgroundColor: "#fff", borderRadius: "32px", padding: "12px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.logoSrc} width={186} height={186} style={{ width: "186px", height: "186px", objectFit: "contain" }} alt="Utilia" />
      </div>
```

por:

```tsx
      <div style={{ position: "absolute", top: "48px", left: "48px", width: "240px", height: "240px", display: "flex", backgroundColor: "#fff", borderRadius: "36px", padding: "15px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.logoSrc} width={210} height={210} style={{ width: "210px", height: "210px", objectFit: "contain" }} alt="Utilia" />
      </div>
```

- [ ] **Step 3: Reemplazar el logo suelto de la Plantilla C por un badge**

En `TemplateC`, reemplaza:

```tsx
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.logoSrc} width={96} height={96} style={{ width: "96px", height: "96px", objectFit: "contain", marginRight: "20px" }} alt="Utilia" />
          <div style={{ display: "flex", fontSize: "34px", fontWeight: 800, color: BLUE, letterSpacing: "4px" }}>LIQUIDACIÓN</div>
        </div>
```

por:

```tsx
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", width: "130px", height: "130px", backgroundColor: BLUE, borderRadius: "24px", padding: "10px", marginRight: "24px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.logoSrc} width={110} height={110} style={{ width: "110px", height: "110px", objectFit: "contain" }} alt="Utilia" />
          </div>
          <div style={{ display: "flex", fontSize: "34px", fontWeight: 800, color: BLUE, letterSpacing: "4px" }}>LIQUIDACIÓN</div>
        </div>
```

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/estados/[id]/templates.tsx"
git commit -m "feat(estados): logo mas visible en las 3 plantillas"
```

---

## Task 3: Capa de datos para el selector de producto

**Files:** Modify `src/lib/analytics/status-posts.ts`

- [ ] **Step 1: Reemplazar TODO el archivo**

Reemplaza el contenido completo de `src/lib/analytics/status-posts.ts` por:

```ts
/**
 * Selección diaria de "Estados de WhatsApp" para liquidar capital muerto.
 *
 * Cada día elige 3 productos de capital muerto (rotationDays > 30, stock > 0),
 * priorizando el mayor capital invertido (stockQty * cmp), sin repetir un
 * producto usado en los últimos DAYS_BEFORE_REPEAT días. Aplica descuento
 * escalonado por antigüedad y genera una línea de copy con IA. Persiste en
 * StatusPost para que al recargar se vean los mismos 3.
 */

import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import type { StatusPost } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { colombiaToday, colombiaDaysAgo } from "@/lib/timezone";

const SLOTS = 3;
const DAYS_BEFORE_REPEAT = 14;
const DISCOUNT_HIGH = 30; // rotationDays > 60
const DISCOUNT_LOW = 20;  // rotationDays 31..60

export function discountForRotation(rotationDays: number): number {
  return rotationDays > 60 ? DISCOUNT_HIGH : DISCOUNT_LOW;
}

/** Redondea a múltiplo de 100 COP para un precio "bonito". */
function roundPrice(n: number): number {
  return Math.max(0, Math.round(n / 100) * 100);
}

export function computeFinalPrice(salePrice: number, pct: number): number {
  return roundPrice(salePrice * (1 - pct / 100));
}

// ─── Copy IA ──────────────────────────────────────────────────────────────────

type CopyMode = "liquidacion" | "regular";

const copySchema = z.object({
  copy: z
    .string()
    .describe(
      "UNA sola línea corta (máx 40 caracteres) de gancho en español coloquial colombiano, puede empezar con un emoji. Sin el precio ni el nombre del producto."
    ),
});

const COPY_SYSTEM_PROMPT_LIQUIDACION = `Eres el community manager de Papelería Utilia (Sabaneta, Colombia).
Escribes ganchos cortísimos para Estados de WhatsApp de ofertas de liquidación.
Reglas:
- Una sola línea, máximo 40 caracteres.
- Español coloquial colombiano, cercano, con energía de venta.
- Puedes usar 1 emoji al inicio.
- NO incluyas el precio ni el nombre del producto (ya van en la imagen).
- Transmite urgencia o escasez cuando el stock es bajo.`;

const COPY_SYSTEM_PROMPT_REGULAR = `Eres el community manager de Papelería Utilia (Sabaneta, Colombia).
Escribes ganchos cortísimos para Estados de WhatsApp destacando productos del catálogo regular (NO son oferta ni liquidación).
Reglas:
- Una sola línea, máximo 40 caracteres.
- Español coloquial colombiano, cercano, con energía de venta.
- Puedes usar 1 emoji al inicio.
- NO incluyas el precio ni el nombre del producto (ya van en la imagen).
- NO menciones descuento, oferta ni urgencia falsa; destaca calidad, utilidad o popularidad del producto.`;

async function generateCopy(input: {
  name: string;
  stockQty: number;
  category: string | null;
  discountPct: number;
  mode: CopyMode;
}): Promise<string> {
  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: copySchema,
      system: input.mode === "regular" ? COPY_SYSTEM_PROMPT_REGULAR : COPY_SYSTEM_PROMPT_LIQUIDACION,
      prompt: `Producto: ${input.name}
Stock disponible: ${input.stockQty}
Categoría: ${input.category ?? "—"}
Descuento: ${input.discountPct}%

Genera el gancho.`,
    });
    return object.copy.trim().slice(0, 60);
  } catch {
    return fallbackCopy(input.stockQty, input.mode);
  }
}

function fallbackCopy(stockQty: number, mode: CopyMode): string {
  if (mode === "regular") return "✨ Recomendado del día";
  return stockQty <= 5 ? `🔥 ¡Últimas ${stockQty} unidades!` : "🔥 Oferta de liquidación";
}

// ─── Selección ──────────────────────────────────────────────────────────────

export interface Candidate {
  odooProductId: number;
  name: string;
  category: string | null;
  stockQty: number;
  salePrice: number;
  rotationDays: number;
  invested: number;
}

/** Capital muerto ordenado por capital invertido desc. */
export async function rankedDeadStock(): Promise<Candidate[]> {
  const dead = await prisma.productInsight.findMany({
    where: { rotationDays: { gt: 30 }, stockQty: { gt: 0 } },
  });
  return dead
    .map((p) => ({
      odooProductId: p.odooProductId,
      name: p.name,
      category: p.category,
      stockQty: Math.floor(p.stockQty),
      salePrice: p.salePrice,
      rotationDays: p.rotationDays,
      invested: p.stockQty * p.cmp,
    }))
    .filter((c) => c.stockQty > 0 && c.salePrice > 0)
    .sort((a, b) => b.invested - a.invested);
}

/** Productos regulares (no capital muerto) con stock, para el selector manual. */
export async function rankedRegularStock(): Promise<Candidate[]> {
  const regular = await prisma.productInsight.findMany({
    where: { rotationDays: { lte: 30 }, stockQty: { gt: 0 } },
  });
  return regular
    .map((p) => ({
      odooProductId: p.odooProductId,
      name: p.name,
      category: p.category,
      stockQty: Math.floor(p.stockQty),
      salePrice: p.salePrice,
      rotationDays: p.rotationDays,
      invested: p.stockQty * p.cmp,
    }))
    .filter((c) => c.stockQty > 0 && c.salePrice > 0)
    .sort((a, b) => b.stockQty - a.stockQty);
}

async function recentlyPostedIds(): Promise<Set<number>> {
  const since = colombiaDaysAgo(DAYS_BEFORE_REPEAT);
  const recent = await prisma.statusPost.findMany({
    where: { date: { gte: since } },
    select: { odooProductId: true },
  });
  return new Set(recent.map((r) => r.odooProductId));
}

async function createPostFromCandidate(date: Date, slot: number, c: Candidate): Promise<StatusPost> {
  const discountPct = discountForRotation(c.rotationDays);
  const finalPrice = computeFinalPrice(c.salePrice, discountPct);
  const copy = await generateCopy({
    name: c.name,
    stockQty: c.stockQty,
    category: c.category,
    discountPct,
    mode: "liquidacion",
  });
  return prisma.statusPost.create({
    data: {
      date,
      slot,
      odooProductId: c.odooProductId,
      productName: c.name,
      category: c.category,
      stockQty: c.stockQty,
      salePrice: c.salePrice,
      discountPct,
      finalPrice,
      copy,
    },
  });
}

/**
 * Devuelve los StatusPost de HOY (Colombia). Si no existen, los crea:
 * elige por capital invertido desc, excluye productos posteados en los
 * últimos DAYS_BEFORE_REPEAT días; si la cola se agota, reinicia (permite
 * repetir). Idempotente por el unique [date, slot].
 */
export async function getOrCreateTodayStatusPosts(): Promise<StatusPost[]> {
  const today = colombiaToday();
  const existing = await prisma.statusPost.findMany({
    where: { date: today },
    orderBy: { slot: "asc" },
  });
  if (existing.length > 0) return existing;

  const ranked = await rankedDeadStock();
  if (ranked.length === 0) return [];

  const recentIds = await recentlyPostedIds();
  let pool = ranked.filter((c) => !recentIds.has(c.odooProductId));
  if (pool.length < SLOTS) pool = ranked; // cola agotada → reiniciar

  const chosen = pool.slice(0, SLOTS);
  const created: StatusPost[] = [];
  for (let i = 0; i < chosen.length; i++) {
    try {
      created.push(await createPostFromCandidate(today, i + 1, chosen[i]));
    } catch {
      // Carrera con otra request que ya creó este slot: recargar y salir.
      return prisma.statusPost.findMany({ where: { date: today }, orderBy: { slot: "asc" } });
    }
  }
  return created;
}

// ─── Edición ──────────────────────────────────────────────────────────────

/** Cambia el producto de un slot por el siguiente disponible en la cola. */
export async function swapStatusPostProduct(id: string): Promise<StatusPost> {
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });
  const usedToday = await prisma.statusPost.findMany({
    where: { date: post.date },
    select: { odooProductId: true },
  });
  const usedIds = new Set(usedToday.map((u) => u.odooProductId));
  const recentIds = await recentlyPostedIds();

  const ranked = await rankedDeadStock();
  const next =
    ranked.find((c) => !usedIds.has(c.odooProductId) && !recentIds.has(c.odooProductId)) ??
    ranked.find((c) => !usedIds.has(c.odooProductId));
  if (!next) return post; // no hay otro producto para ofrecer

  const discountPct = discountForRotation(next.rotationDays);
  const finalPrice = computeFinalPrice(next.salePrice, discountPct);
  const copy = await generateCopy({
    name: next.name,
    stockQty: next.stockQty,
    category: next.category,
    discountPct,
    mode: "liquidacion",
  });
  return prisma.statusPost.update({
    where: { id },
    data: {
      odooProductId: next.odooProductId,
      productName: next.name,
      category: next.category,
      stockQty: next.stockQty,
      salePrice: next.salePrice,
      discountPct,
      finalPrice,
      copy,
      posted: false,
      postedAt: null,
    },
  });
}

/** Reemplaza el producto de un slot por uno elegido a mano (liquidación o regular). */
export async function pickStatusPostProduct(id: string, odooProductId: number): Promise<StatusPost> {
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });

  const usedToday = await prisma.statusPost.findMany({
    where: { date: post.date, id: { not: id } },
    select: { odooProductId: true },
  });
  if (usedToday.some((u) => u.odooProductId === odooProductId)) {
    throw new Error("Ese producto ya está en otra tarjeta de hoy");
  }

  const candidate = await prisma.productInsight.findUnique({ where: { odooProductId } });
  if (!candidate || candidate.stockQty <= 0 || candidate.salePrice <= 0) {
    throw new Error("Producto no disponible");
  }

  const mode: CopyMode = candidate.rotationDays > 30 ? "liquidacion" : "regular";
  const discountPct = mode === "liquidacion" ? discountForRotation(candidate.rotationDays) : 0;
  const finalPrice = computeFinalPrice(candidate.salePrice, discountPct);
  const copy = await generateCopy({
    name: candidate.name,
    stockQty: Math.floor(candidate.stockQty),
    category: candidate.category,
    discountPct,
    mode,
  });

  return prisma.statusPost.update({
    where: { id },
    data: {
      odooProductId: candidate.odooProductId,
      productName: candidate.name,
      category: candidate.category,
      stockQty: Math.floor(candidate.stockQty),
      salePrice: candidate.salePrice,
      discountPct,
      finalPrice,
      copy,
      posted: false,
      postedAt: null,
    },
  });
}

/** Regenera solo el copy IA de un estado (usa el modo del producto actual). */
export async function regenerateStatusPostCopy(id: string): Promise<StatusPost> {
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });
  const insight = await prisma.productInsight.findUnique({ where: { odooProductId: post.odooProductId } });
  const mode: CopyMode = insight && insight.rotationDays <= 30 ? "regular" : "liquidacion";
  const copy = await generateCopy({
    name: post.productName,
    stockQty: post.stockQty,
    category: post.category,
    discountPct: post.discountPct,
    mode,
  });
  return prisma.statusPost.update({ where: { id }, data: { copy } });
}

/** Cambia el % de descuento y recalcula el precio final. */
export async function updateStatusPostDiscount(id: string, pct: number): Promise<StatusPost> {
  const clamped = Math.min(90, Math.max(0, Math.round(pct)));
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });
  const finalPrice = computeFinalPrice(post.salePrice, clamped);
  return prisma.statusPost.update({
    where: { id },
    data: { discountPct: clamped, finalPrice },
  });
}

/** Marca (o desmarca) un estado como publicado. */
export async function markStatusPostPosted(id: string, posted: boolean): Promise<void> {
  await prisma.statusPost.update({
    where: { id },
    data: { posted, postedAt: posted ? new Date() : null },
  });
}

/** Cambia la plantilla visual (A/B/C) de un estado. */
export async function updateStatusPostTemplate(
  id: string,
  template: "A" | "B" | "C"
): Promise<StatusPost> {
  return prisma.statusPost.update({ where: { id }, data: { template } });
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores (`swapStatusPostProduct` queda sin usar por ahora — se elimina en la Tarea 7 — pero eso no es un error de tipos).

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/status-posts.ts
git commit -m "feat(estados): rankedRegularStock, pickStatusPostProduct y copy por modo"
```

---

## Task 4: Server action `pickProductAction`

**Files:** Modify `src/app/(dashboard)/campanas/status-actions.ts`

- [ ] **Step 1: Sumar `pickStatusPostProduct` a los imports**

Reemplaza:

```ts
import {
  swapStatusPostProduct,
  regenerateStatusPostCopy,
  updateStatusPostDiscount,
  markStatusPostPosted,
  updateStatusPostTemplate,
} from "@/lib/analytics/status-posts";
```

por:

```ts
import {
  swapStatusPostProduct,
  regenerateStatusPostCopy,
  updateStatusPostDiscount,
  markStatusPostPosted,
  updateStatusPostTemplate,
  pickStatusPostProduct,
} from "@/lib/analytics/status-posts";
```

- [ ] **Step 2: Agregar la acción al final del archivo**

```ts
export async function pickProductAction(id: string, odooProductId: number) {
  try {
    await requireSession();
    await pickStatusPostProduct(id, odooProductId);
    revalidatePath("/campanas");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/campanas/status-actions.ts"
git commit -m "feat(estados): server action pickProductAction"
```

---

## Task 5: Componente `Dialog` de shadcn

**Files:** Create `src/components/ui/dialog.tsx`

- [ ] **Step 1: Agregar el componente vía CLI**

Run: `npx shadcn@latest add dialog -y`
Expected: crea `src/components/ui/dialog.tsx` (usa el paquete unificado `radix-ui`, mismo patrón que `src/components/ui/tabs.tsx`); no debería pedir sobreescribir nada porque el archivo no existe todavía.

- [ ] **Step 2: Verificar que exporta lo esperado**

Abre `src/components/ui/dialog.tsx` y confirma que exporta al menos: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` (los usa la Tarea 6).

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/dialog.tsx
git commit -m "chore(ui): agregar componente Dialog de shadcn"
```

---

## Task 6: Componente `ProductPickerDialog`

**Files:** Create `src/components/dashboard/ProductPickerDialog.tsx`

- [ ] **Step 1: Crear el archivo completo**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Search, Flame, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface PickerProduct {
  odooProductId: number;
  name: string;
  category: string | null;
  stockQty: number;
  rotationDays: number;
}

interface ProductPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  liquidacionPool: PickerProduct[];
  regularPool: PickerProduct[];
  excludeIds: number[];
  onPick: (odooProductId: number) => void;
  pending: boolean;
}

function ProductList({
  products,
  query,
  excludeIds,
  showRotation,
  onPick,
  pending,
}: {
  products: PickerProduct[];
  query: string;
  excludeIds: number[];
  showRotation: boolean;
  onPick: (odooProductId: number) => void;
  pending: boolean;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => !excludeIds.includes(p.odooProductId))
      .filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [products, query, excludeIds]);

  if (filtered.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">Sin productos disponibles</p>;
  }

  return (
    <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
      {filtered.map((p) => (
        <button
          key={p.odooProductId}
          disabled={pending}
          onClick={() => onPick(p.odooProductId)}
          className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-secondary disabled:opacity-50"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{p.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {p.category ?? "Sin categoría"} · Stock {Math.round(p.stockQty)}
              {showRotation ? ` · ${p.rotationDays}d sin rotar` : ""}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function ProductPickerDialog({
  open,
  onOpenChange,
  liquidacionPool,
  regularPool,
  excludeIds,
  onPick,
  pending,
}: ProductPickerDialogProps) {
  const [query, setQuery] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Elegir producto</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto..."
            className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm"
          />
        </div>
        <Tabs defaultValue="liquidacion">
          <TabsList className="w-full">
            <TabsTrigger value="liquidacion" className="flex-1 gap-1.5">
              <Flame className="h-3.5 w-3.5" /> Liquidación
            </TabsTrigger>
            <TabsTrigger value="regular" className="flex-1 gap-1.5">
              <Package className="h-3.5 w-3.5" /> Regulares
            </TabsTrigger>
          </TabsList>
          <TabsContent value="liquidacion">
            <ProductList
              products={liquidacionPool}
              query={query}
              excludeIds={excludeIds}
              showRotation
              onPick={onPick}
              pending={pending}
            />
          </TabsContent>
          <TabsContent value="regular">
            <ProductList
              products={regularPool}
              query={query}
              excludeIds={excludeIds}
              showRotation={false}
              onPick={onPick}
              pending={pending}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/ProductPickerDialog.tsx
git commit -m "feat(estados): componente ProductPickerDialog"
```

---

## Task 7: Reemplazar "Cambiar" por el selector y retirar el swap aleatorio

**Files:** Modify `src/components/dashboard/StatusPostsToday.tsx`, `src/app/(dashboard)/campanas/page.tsx`, `src/lib/analytics/status-posts.ts`, `src/app/(dashboard)/campanas/status-actions.ts`

- [ ] **Step 1: Reemplazar TODO `StatusPostsToday.tsx`**

Reemplaza el contenido completo de `src/components/dashboard/StatusPostsToday.tsx` por:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, RefreshCw, Search, Check } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  regenerateCopyAction,
  updateDiscountAction,
  markPostedAction,
  setTemplateAction,
  pickProductAction,
} from "@/app/(dashboard)/campanas/status-actions";
import { ProductPickerDialog, type PickerProduct } from "./ProductPickerDialog";

export interface StatusPostView {
  id: string;
  slot: number;
  odooProductId: number;
  productName: string;
  stockQty: number;
  salePrice: number;
  discountPct: number;
  finalPrice: number;
  copy: string;
  posted: boolean;
  template: "A" | "B" | "C";
  version: number; // updatedAt en ms, para cache-bust de la imagen
}

function StatusCard({
  post,
  excludeIds,
  liquidacionPool,
  regularPool,
}: {
  post: StatusPostView;
  excludeIds: number[];
  liquidacionPool: PickerProduct[];
  regularPool: PickerProduct[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pct, setPct] = useState(String(Math.round(post.discountPct)));
  const [pickerOpen, setPickerOpen] = useState(false);
  const imgUrl = `/api/estados/${post.id}?v=${post.version}`;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(okMsg);
        router.refresh();
      } else {
        toast.error(r.error ?? "Error");
      }
    });
  }

  function handlePick(odooProductId: number) {
    setPickerOpen(false);
    run(() => pickProductAction(post.id, odooProductId), "Producto actualizado");
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      <div className="relative mx-auto w-full max-w-[220px] overflow-hidden rounded-lg" style={{ aspectRatio: "9 / 16" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imgUrl} alt={post.productName} className="h-full w-full object-cover" />
        {post.posted && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <span className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
              <Check className="h-3.5 w-3.5" /> Publicado
            </span>
          </div>
        )}
      </div>

      <div className="text-center">
        <p className="truncate text-sm font-semibold" title={post.productName}>{post.productName}</p>
        <p className="text-xs text-muted-foreground">
          Stock {post.stockQty} · <span className="line-through">{formatCurrency(post.salePrice)}</span>{" "}
          <span className="font-semibold text-foreground">{formatCurrency(post.finalPrice)}</span>
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Plantilla</span>
        <div className="ml-auto flex gap-1">
          {(["A", "B", "C"] as const).map((t) => (
            <button
              key={t}
              disabled={pending}
              onClick={() => run(() => setTemplateAction(post.id, t), `Plantilla ${t}`)}
              className={cn(
                "h-7 w-7 rounded text-xs font-bold disabled:opacity-50",
                post.template === t
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:bg-secondary"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Desc.</span>
        <input
          type="number"
          min={0}
          max={90}
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          className="w-16 rounded border border-border bg-background px-2 py-1 text-sm"
        />
        <span className="text-xs text-muted-foreground">%</span>
        <button
          disabled={pending}
          onClick={() => run(() => updateDiscountAction(post.id, Number(pct)), "Descuento actualizado")}
          className="ml-auto rounded bg-secondary px-2 py-1 text-xs font-medium hover:bg-secondary/80 disabled:opacity-50"
        >
          Aplicar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <a
          href={imgUrl}
          download={`estado-utilia-${post.slot}.png`}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          <Download className="h-3.5 w-3.5" /> Descargar
        </a>
        <button
          disabled={pending}
          onClick={() => run(() => markPostedAction(post.id, !post.posted), post.posted ? "Marcado pendiente" : "Marcado publicado")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50",
            post.posted ? "bg-secondary text-foreground" : "border border-border hover:bg-secondary"
          )}
        >
          <Check className="h-3.5 w-3.5" /> {post.posted ? "Publicado" : "Marcar"}
        </button>
        <button
          disabled={pending}
          onClick={() => run(() => regenerateCopyAction(post.id), "Texto regenerado")}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Texto
        </button>
        <button
          disabled={pending}
          onClick={() => setPickerOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" /> Elegir producto
        </button>
      </div>

      <ProductPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        liquidacionPool={liquidacionPool}
        regularPool={regularPool}
        excludeIds={excludeIds}
        onPick={handlePick}
        pending={pending}
      />
    </div>
  );
}

export function StatusPostsToday({
  posts,
  liquidacionPool,
  regularPool,
}: {
  posts: StatusPostView[];
  liquidacionPool: PickerProduct[];
  regularPool: PickerProduct[];
}) {
  if (posts.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Estados de hoy para WhatsApp</h3>
        <p className="text-xs text-muted-foreground">
          Descarga cada imagen y súbela a tu Estado de WhatsApp. 3 al día para mover capital muerto.
          Descargar → WhatsApp → Estado → subir la imagen.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((p) => (
          <StatusCard
            key={p.id}
            post={p}
            excludeIds={posts.filter((o) => o.id !== p.id).map((o) => o.odooProductId)}
            liquidacionPool={liquidacionPool}
            regularPool={regularPool}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Actualizar imports y fetch de datos en `page.tsx`**

En `src/app/(dashboard)/campanas/page.tsx`, reemplaza:

```ts
import { getOrCreateTodayStatusPosts } from "@/lib/analytics/status-posts";
import { StatusPostsToday, type StatusPostView } from "@/components/dashboard/StatusPostsToday";
```

por:

```ts
import { getOrCreateTodayStatusPosts, rankedDeadStock, rankedRegularStock } from "@/lib/analytics/status-posts";
import { StatusPostsToday, type StatusPostView } from "@/components/dashboard/StatusPostsToday";
```

- [ ] **Step 3: Cargar los pools y mapear `odooProductId`**

En `src/app/(dashboard)/campanas/page.tsx`, reemplaza:

```ts
  const statusPosts = await getOrCreateTodayStatusPosts().catch(() => []);
  const statusView: StatusPostView[] = statusPosts.map((p) => ({
    id: p.id,
    slot: p.slot,
    productName: p.productName,
    stockQty: p.stockQty,
    salePrice: p.salePrice,
    discountPct: p.discountPct,
    finalPrice: p.finalPrice,
    copy: p.copy,
    posted: p.posted,
    template: p.template as "A" | "B" | "C",
    version: new Date(p.updatedAt).getTime(),
  }));
```

por:

```ts
  const [statusPosts, liquidacionPool, regularPool] = await Promise.all([
    getOrCreateTodayStatusPosts().catch(() => []),
    rankedDeadStock().catch(() => []),
    rankedRegularStock().catch(() => []),
  ]);
  const statusView: StatusPostView[] = statusPosts.map((p) => ({
    id: p.id,
    slot: p.slot,
    odooProductId: p.odooProductId,
    productName: p.productName,
    stockQty: p.stockQty,
    salePrice: p.salePrice,
    discountPct: p.discountPct,
    finalPrice: p.finalPrice,
    copy: p.copy,
    posted: p.posted,
    template: p.template as "A" | "B" | "C",
    version: new Date(p.updatedAt).getTime(),
  }));
```

- [ ] **Step 4: Pasar los pools a `StatusPostsToday`**

En `src/app/(dashboard)/campanas/page.tsx`, reemplaza:

```tsx
      <StatusPostsToday posts={statusView} />
```

por:

```tsx
      <StatusPostsToday posts={statusView} liquidacionPool={liquidacionPool} regularPool={regularPool} />
```

- [ ] **Step 5: Eliminar `swapStatusPostProduct` (ya sin uso) de `status-posts.ts`**

En `src/lib/analytics/status-posts.ts`, reemplaza:

```ts
/** Cambia el producto de un slot por el siguiente disponible en la cola. */
export async function swapStatusPostProduct(id: string): Promise<StatusPost> {
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });
  const usedToday = await prisma.statusPost.findMany({
    where: { date: post.date },
    select: { odooProductId: true },
  });
  const usedIds = new Set(usedToday.map((u) => u.odooProductId));
  const recentIds = await recentlyPostedIds();

  const ranked = await rankedDeadStock();
  const next =
    ranked.find((c) => !usedIds.has(c.odooProductId) && !recentIds.has(c.odooProductId)) ??
    ranked.find((c) => !usedIds.has(c.odooProductId));
  if (!next) return post; // no hay otro producto para ofrecer

  const discountPct = discountForRotation(next.rotationDays);
  const finalPrice = computeFinalPrice(next.salePrice, discountPct);
  const copy = await generateCopy({
    name: next.name,
    stockQty: next.stockQty,
    category: next.category,
    discountPct,
    mode: "liquidacion",
  });
  return prisma.statusPost.update({
    where: { id },
    data: {
      odooProductId: next.odooProductId,
      productName: next.name,
      category: next.category,
      stockQty: next.stockQty,
      salePrice: next.salePrice,
      discountPct,
      finalPrice,
      copy,
      posted: false,
      postedAt: null,
    },
  });
}

/** Reemplaza el producto de un slot por uno elegido a mano (liquidación o regular). */
```

por:

```ts
/** Reemplaza el producto de un slot por uno elegido a mano (liquidación o regular). */
```

- [ ] **Step 6: Eliminar `swapProductAction` (ya sin uso) de `status-actions.ts`**

En `src/app/(dashboard)/campanas/status-actions.ts`, reemplaza:

```ts
import {
  swapStatusPostProduct,
  regenerateStatusPostCopy,
  updateStatusPostDiscount,
  markStatusPostPosted,
  updateStatusPostTemplate,
  pickStatusPostProduct,
} from "@/lib/analytics/status-posts";
```

por:

```ts
import {
  regenerateStatusPostCopy,
  updateStatusPostDiscount,
  markStatusPostPosted,
  updateStatusPostTemplate,
  pickStatusPostProduct,
} from "@/lib/analytics/status-posts";
```

Y reemplaza:

```ts
export async function swapProductAction(id: string) {
  try {
    await requireSession();
    await swapStatusPostProduct(id);
    revalidatePath("/campanas");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function regenerateCopyAction(id: string) {
```

por:

```ts
export async function regenerateCopyAction(id: string) {
```

- [ ] **Step 7: Verificar tipos y build**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 8: Commit**

```bash
git add "src/components/dashboard/StatusPostsToday.tsx" "src/app/(dashboard)/campanas/page.tsx" "src/lib/analytics/status-posts.ts" "src/app/(dashboard)/campanas/status-actions.ts"
git commit -m "feat(estados): selector manual de producto (Liquidacion/Regulares)"
```

---

## Task 8: Indicador de carga (overlay + spinner por acción)

**Files:** Modify `src/components/dashboard/StatusPostsToday.tsx`

- [ ] **Step 1: Importar `Loader2`**

Reemplaza:

```tsx
import { Download, RefreshCw, Search, Check } from "lucide-react";
```

por:

```tsx
import { Download, RefreshCw, Search, Check, Loader2 } from "lucide-react";
```

- [ ] **Step 2: Trackear qué acción está en curso**

Reemplaza:

```tsx
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pct, setPct] = useState(String(Math.round(post.discountPct)));
  const [pickerOpen, setPickerOpen] = useState(false);
  const imgUrl = `/api/estados/${post.id}?v=${post.version}`;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(okMsg);
        router.refresh();
      } else {
        toast.error(r.error ?? "Error");
      }
    });
  }

  function handlePick(odooProductId: number) {
    setPickerOpen(false);
    run(() => pickProductAction(post.id, odooProductId), "Producto actualizado");
  }
```

por:

```tsx
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [pct, setPct] = useState(String(Math.round(post.discountPct)));
  const [pickerOpen, setPickerOpen] = useState(false);
  const imgUrl = `/api/estados/${post.id}?v=${post.version}`;

  function run(action: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setActiveAction(action);
    startTransition(async () => {
      const r = await fn();
      setActiveAction(null);
      if (r.ok) {
        toast.success(okMsg);
        router.refresh();
      } else {
        toast.error(r.error ?? "Error");
      }
    });
  }

  function handlePick(odooProductId: number) {
    setPickerOpen(false);
    run("product", () => pickProductAction(post.id, odooProductId), "Producto actualizado");
  }
```

- [ ] **Step 3: Overlay con spinner sobre la preview**

Reemplaza:

```tsx
        {post.posted && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <span className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
              <Check className="h-3.5 w-3.5" /> Publicado
            </span>
          </div>
        )}
      </div>
```

por:

```tsx
        {post.posted && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <span className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
              <Check className="h-3.5 w-3.5" /> Publicado
            </span>
          </div>
        )}
        {pending && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
      </div>
```

- [ ] **Step 4: Spinner en los botones A/B/C**

Reemplaza:

```tsx
              onClick={() => run(() => setTemplateAction(post.id, t), `Plantilla ${t}`)}
              className={cn(
                "h-7 w-7 rounded text-xs font-bold disabled:opacity-50",
                post.template === t
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:bg-secondary"
              )}
            >
              {t}
            </button>
```

por:

```tsx
              onClick={() => run("template", () => setTemplateAction(post.id, t), `Plantilla ${t}`)}
              className={cn(
                "h-7 w-7 rounded text-xs font-bold disabled:opacity-50",
                post.template === t
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:bg-secondary"
              )}
            >
              {activeAction === "template" && pending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : t}
            </button>
```

- [ ] **Step 5: Spinner en "Aplicar" (descuento)**

Reemplaza:

```tsx
        <button
          disabled={pending}
          onClick={() => run(() => updateDiscountAction(post.id, Number(pct)), "Descuento actualizado")}
          className="ml-auto rounded bg-secondary px-2 py-1 text-xs font-medium hover:bg-secondary/80 disabled:opacity-50"
        >
          Aplicar
        </button>
```

por:

```tsx
        <button
          disabled={pending}
          onClick={() => run("discount", () => updateDiscountAction(post.id, Number(pct)), "Descuento actualizado")}
          className="ml-auto flex items-center gap-1.5 rounded bg-secondary px-2 py-1 text-xs font-medium hover:bg-secondary/80 disabled:opacity-50"
        >
          {activeAction === "discount" && pending && <Loader2 className="h-3 w-3 animate-spin" />}
          Aplicar
        </button>
```

- [ ] **Step 6: Spinner en "Marcar/Publicado"**

Reemplaza:

```tsx
        <button
          disabled={pending}
          onClick={() => run(() => markPostedAction(post.id, !post.posted), post.posted ? "Marcado pendiente" : "Marcado publicado")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50",
            post.posted ? "bg-secondary text-foreground" : "border border-border hover:bg-secondary"
          )}
        >
          <Check className="h-3.5 w-3.5" /> {post.posted ? "Publicado" : "Marcar"}
        </button>
```

por:

```tsx
        <button
          disabled={pending}
          onClick={() => run("posted", () => markPostedAction(post.id, !post.posted), post.posted ? "Marcado pendiente" : "Marcado publicado")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50",
            post.posted ? "bg-secondary text-foreground" : "border border-border hover:bg-secondary"
          )}
        >
          {activeAction === "posted" && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {post.posted ? "Publicado" : "Marcar"}
        </button>
```

- [ ] **Step 7: Spinner en "Texto"**

Reemplaza:

```tsx
        <button
          disabled={pending}
          onClick={() => run(() => regenerateCopyAction(post.id), "Texto regenerado")}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Texto
        </button>
```

por:

```tsx
        <button
          disabled={pending}
          onClick={() => run("copy", () => regenerateCopyAction(post.id), "Texto regenerado")}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          {activeAction === "copy" && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Texto
        </button>
```

- [ ] **Step 8: Spinner en "Elegir producto"**

Reemplaza:

```tsx
        <button
          disabled={pending}
          onClick={() => setPickerOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" /> Elegir producto
        </button>
```

por:

```tsx
        <button
          disabled={pending}
          onClick={() => setPickerOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          {activeAction === "product" && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Elegir producto
        </button>
```

- [ ] **Step 9: Verificar tipos y build**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 10: Commit**

```bash
git add "src/components/dashboard/StatusPostsToday.tsx"
git commit -m "feat(estados): overlay y spinner de carga por accion"
```

---

## Task 9: Verificación en preview

**Files:** ninguno (verificación)

- [ ] **Step 1: Arrancar el preview**

Arranca el server de preview (`preview_start`, config `utilia-dev`, `next dev` en puerto 3000) y navega a `/campanas`.

- [ ] **Step 2: Descuento en 0%**

En una tarjeta, pon "Desc." en `0` y haz clic en "Aplicar". Espera a que la imagen se regenere.
Expected: la insignia de descuento desaparece en las 3 plantillas (probar cambiando A/B/C con el selector existente) sin dejar huecos o espacios raros, especialmente en C donde el precio final queda solo (alineado a la izquierda).

- [ ] **Step 3: Selector de producto**

Haz clic en "Elegir producto". Cambia entre las pestañas "Liquidación" y "Regulares", escribe algo en el buscador y confirma que la lista se filtra. Elige un producto de Liquidación.
Expected: toast "Producto actualizado"; la tarjeta muestra el nuevo producto con descuento (>0%) y la imagen se regenera.

Repite eligiendo un producto de "Regulares".
Expected: el descuento queda en 0% (la insignia no aparece, confirmando la Tarea 1) y el copy no menciona oferta ni urgencia.

Abre el picker en otra tarjeta y confirma que el producto recién asignado a la primera tarjeta ya no aparece en la lista (excluido por `excludeIds`).

- [ ] **Step 4: Logo**

Compara visualmente (o con `computer {action: "zoom"}` sobre la preview) el tamaño del logo en A, B y C contra capturas previas: debe verse claramente más grande, sobre todo en C.

- [ ] **Step 5: Indicador de carga**

Dispara cualquier acción (plantilla, descuento, marcar, texto, elegir producto) y confirma que durante la espera aparece el overlay oscuro con spinner sobre la imagen, y el ícono del botón presionado cambia a un spinner girando.

- [ ] **Step 6: Revisar errores y detener**

Revisar consola del navegador (`read_console_messages`) y logs del server (`preview_logs`) por errores. Detener el preview.

- [ ] **Step 7: Merge / PR**

Con todo verde, seguir `superpowers:finishing-a-development-branch`.

---

## Self-Review (cobertura del spec)

- **Ocultar descuento en 0% (las 3 plantillas, sin huecos):** Task 1. ✓
- **Selector manual, dos pestañas Liquidación/Regulares, sin llamadas extra al elegir:** Tasks 3 (datos), 4 (acción), 5 (Dialog), 6 (componente), 7 (wiring + fetch de pools en `page.tsx`). ✓
- **Modo decidido por el dato real (`rotationDays`), no por lo que manda el cliente:** `pickStatusPostProduct` en Task 3. ✓
- **Descuento 0% + copy neutro para Regulares, escalonado + copy de urgencia para Liquidación:** Task 3 (`generateCopy` con `mode`, `pickStatusPostProduct`). ✓
- **Excluir productos ya usados hoy en otra tarjeta:** `pickStatusPostProduct` (Task 3) + `excludeIds` en la UI (Task 7). ✓
- **Selección automática diaria sin cambios:** `getOrCreateTodayStatusPosts` no se toca en ningún task. ✓
- **Logo más visible en las 3 plantillas:** Task 2. ✓
- **Overlay + spinner en botón activo:** Task 8. ✓
- **Sin dead code (swap aleatorio retirado):** Task 7, Steps 5-6. ✓
- **Testing:** Task 9 cubre las 4 mejoras en preview manual (patrón `tsc --noEmit` + verificación visual, igual que el plan anterior de plantillas A/B/C). ✓
