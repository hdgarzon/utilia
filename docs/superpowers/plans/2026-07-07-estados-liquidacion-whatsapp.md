# Estados de WhatsApp para Liquidación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generar cada día 3 "Estados de WhatsApp" listos (imagen 1080×1920 con logo, foto real del producto, precio rebajado y copy IA) desde la pantalla `/liquidacion`, para descargar y publicar manualmente y así mover capital muerto.

**Architecture:** Un módulo de selección (`status-posts.ts`) elige 3 productos de capital muerto por día (mayor capital invertido, sin repetir), les aplica descuento escalonado y genera copy con IA, persistiendo en una tabla `StatusPost`. Una ruta `/api/estados/[id]` renderiza la imagen final con `next/og` (`ImageResponse`) usando la foto de Odoo y el logo local. La UI en `/liquidacion` muestra esas mismas imágenes con botones de descargar/editar/regenerar/marcar publicado.

**Tech Stack:** Next.js 15 (App Router, `next/og`), React 19, Prisma 6 (Postgres, `db push`), Vercel AI SDK (`ai` + `@ai-sdk/openai`, `gpt-4o-mini`), Odoo JSON-RPC, Tailwind, sonner (toasts).

**Nota de convención:** Este repo **no tiene framework de tests**. La verificación sigue la convención de los planes previos: `npx tsc --noEmit` para tipos + verificación manual en el preview. No se agrega Vitest/Jest.

**Nota de zona horaria:** Todo "hoy" usa `colombiaToday()` de `src/lib/timezone.ts` (Date a medianoche UTC del día en Colombia, UTC-5).

---

## File Structure

- Create: `src/lib/analytics/status-posts.ts` — selección diaria, descuento, copy IA, helpers de edición.
- Create: `src/app/(dashboard)/liquidacion/status-actions.ts` — server actions (auth + revalidate).
- Create: `src/app/api/estados/[id]/route.tsx` — genera el PNG del estado con `ImageResponse`.
- Create: `src/components/dashboard/StatusPostsToday.tsx` — UI cliente (previews + controles).
- Modify: `prisma/schema.prisma` — modelo `StatusPost`.
- Modify: `src/lib/odoo.ts` — método `getProductImage(id)`.
- Modify: `src/app/(dashboard)/liquidacion/page.tsx` — integrar la sección "Estados de hoy".

---

## Task 1: Modelo `StatusPost` en Prisma

**Files:**
- Modify: `prisma/schema.prisma` (agregar al final, después de `model AIRecommendation`)

- [ ] **Step 1: Agregar el modelo**

Añade al final de `prisma/schema.prisma`:

```prisma
// ─── Estados de WhatsApp (liquidación) ────────────────────────────────────────

model StatusPost {
  id            String    @id @default(cuid())
  date          DateTime  @db.Date          // día de la selección (Colombia)
  slot          Int                          // 1..3
  odooProductId Int
  productName   String
  category      String?
  stockQty      Int
  salePrice     Float                        // precio lista original
  discountPct   Float                        // 20 o 30 (editable)
  finalPrice    Float                        // precio con descuento, redondeado
  copy          String                       // línea de urgencia (IA)
  posted        Boolean   @default(false)
  postedAt      DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@unique([date, slot])
  @@index([odooProductId])
  @@index([date])
}
```

- [ ] **Step 2: Aplicar el schema a la base y regenerar el cliente**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema" y "Generated Prisma Client".

- [ ] **Step 3: Verificar que el cliente tipa el modelo**

Run: `npx tsc --noEmit`
Expected: sin errores (0 salida). Confirma que `prisma.statusPost` existe en el tipo.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(estados): modelo StatusPost para estados diarios de liquidación"
```

---

## Task 2: Método `getProductImage` en el cliente Odoo

**Files:**
- Modify: `src/lib/odoo.ts` (agregar un método dentro del objeto `odoo`, junto a `getProductsByIds`)

- [ ] **Step 1: Agregar el método**

Dentro del objeto `export const odoo = { ... }`, después de `getProductsByIds`, agrega:

```ts
  /** Trae la imagen base64 (`image_1920`) de un producto por ID. `null` si no tiene. */
  async getProductImage(productId: number): Promise<string | null> {
    const rows = await searchRead<{ id: number; image_1920: string | false }>(
      "product.product",
      ["|", ["active", "=", true], ["active", "=", false], ["id", "=", productId]],
      ["id", "image_1920"],
      { limit: 1 }
    );
    const img = rows[0]?.image_1920;
    return img && img !== false ? (img as string) : null;
  },
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Probar contra Odoo real (script temporal)**

Crea `scripts/tmp-check-image.ts`:

```ts
import { odoo } from "@/lib/odoo";
import { prisma } from "@/lib/prisma";

async function main() {
  const p = await prisma.productInsight.findFirst({
    where: { rotationDays: { gt: 30 }, stockQty: { gt: 0 } },
    orderBy: { stockQty: "desc" },
  });
  if (!p) return console.log("sin capital muerto");
  const img = await odoo.getProductImage(p.odooProductId);
  console.log(p.name, "→", img ? `imagen OK (${Math.round(img.length / 1024)} KB base64)` : "SIN imagen");
}
main().then(() => process.exit(0));
```

Run: `npx tsx --env-file=.env.local scripts/tmp-check-image.ts`
Expected: imprime el nombre de un producto y "imagen OK (…KB)".

- [ ] **Step 4: Borrar el script temporal y commit**

```bash
rm scripts/tmp-check-image.ts
git add src/lib/odoo.ts
git commit -m "feat(estados): odoo.getProductImage para traer la foto del producto"
```

---

## Task 3: Módulo de selección y copy — `status-posts.ts`

**Files:**
- Create: `src/lib/analytics/status-posts.ts`

- [ ] **Step 1: Escribir el módulo completo**

Crea `src/lib/analytics/status-posts.ts`:

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

const copySchema = z.object({
  copy: z
    .string()
    .describe(
      "UNA sola línea corta (máx 40 caracteres) de gancho/urgencia en español coloquial colombiano, puede empezar con un emoji. Sin el precio ni el nombre del producto."
    ),
});

const COPY_SYSTEM_PROMPT = `Eres el community manager de Papelería Utilia (Sabaneta, Colombia).
Escribes ganchos cortísimos para Estados de WhatsApp de ofertas de liquidación.
Reglas:
- Una sola línea, máximo 40 caracteres.
- Español coloquial colombiano, cercano, con energía de venta.
- Puedes usar 1 emoji al inicio.
- NO incluyas el precio ni el nombre del producto (ya van en la imagen).
- Transmite urgencia o escasez cuando el stock es bajo.`;

async function generateCopy(input: {
  name: string;
  stockQty: number;
  category: string | null;
  discountPct: number;
}): Promise<string> {
  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: copySchema,
      system: COPY_SYSTEM_PROMPT,
      prompt: `Producto: ${input.name}
Stock disponible: ${input.stockQty}
Categoría: ${input.category ?? "—"}
Descuento: ${input.discountPct}%

Genera el gancho.`,
    });
    return object.copy.trim().slice(0, 60);
  } catch {
    return fallbackCopy(input.stockQty);
  }
}

function fallbackCopy(stockQty: number): string {
  return stockQty <= 5 ? `🔥 ¡Últimas ${stockQty} unidades!` : "🔥 Oferta de liquidación";
}

// ─── Selección ──────────────────────────────────────────────────────────────

interface Candidate {
  odooProductId: number;
  name: string;
  category: string | null;
  stockQty: number;
  salePrice: number;
  rotationDays: number;
  invested: number;
}

/** Capital muerto ordenado por capital invertido desc. */
async function rankedDeadStock(): Promise<Candidate[]> {
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

/** Regenera solo el copy IA de un estado. */
export async function regenerateStatusPostCopy(id: string): Promise<StatusPost> {
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });
  const copy = await generateCopy({
    name: post.productName,
    stockQty: post.stockQty,
    category: post.category,
    discountPct: post.discountPct,
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
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Probar la selección (script temporal)**

Crea `scripts/tmp-check-selection.ts`:

```ts
import { getOrCreateTodayStatusPosts } from "@/lib/analytics/status-posts";

async function main() {
  const posts = await getOrCreateTodayStatusPosts();
  console.log(`${posts.length} estados de hoy:`);
  for (const p of posts) {
    console.log(
      `  slot ${p.slot}: ${p.productName} | stock ${p.stockQty} | -${p.discountPct}% | $${p.salePrice} → $${p.finalPrice} | "${p.copy}"`
    );
  }
}
main().then(() => process.exit(0));
```

Run: `npx tsx --env-file=.env.local scripts/tmp-check-selection.ts`
Expected: imprime hasta 3 estados con descuento 20 o 30 según rotación, precio final redondeado a múltiplo de 100 y un copy corto. Correr una segunda vez debe imprimir **los mismos 3** (idempotencia).

- [ ] **Step 4: Borrar el script y commit**

```bash
rm scripts/tmp-check-selection.ts
git add src/lib/analytics/status-posts.ts
git commit -m "feat(estados): selección diaria de capital muerto con descuento escalonado y copy IA"
```

---

## Task 4: Server actions — `status-actions.ts`

**Files:**
- Create: `src/app/(dashboard)/liquidacion/status-actions.ts`

- [ ] **Step 1: Escribir las acciones**

Crea `src/app/(dashboard)/liquidacion/status-actions.ts`:

```ts
"use server";

import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  swapStatusPostProduct,
  regenerateStatusPostCopy,
  updateStatusPostDiscount,
  markStatusPostPosted,
} from "@/lib/analytics/status-posts";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("No autorizado");
}

export async function swapProductAction(id: string) {
  try {
    await requireSession();
    await swapStatusPostProduct(id);
    revalidatePath("/liquidacion");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function regenerateCopyAction(id: string) {
  try {
    await requireSession();
    await regenerateStatusPostCopy(id);
    revalidatePath("/liquidacion");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateDiscountAction(id: string, pct: number) {
  try {
    await requireSession();
    await updateStatusPostDiscount(id, pct);
    revalidatePath("/liquidacion");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function markPostedAction(id: string, posted: boolean) {
  try {
    await requireSession();
    await markStatusPostPosted(id, posted);
    revalidatePath("/liquidacion");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/liquidacion/status-actions.ts"
git commit -m "feat(estados): server actions para editar/regenerar/publicar estados"
```

---

## Task 5: Ruta generadora de imagen — `/api/estados/[id]`

**Files:**
- Create: `src/app/api/estados/[id]/route.tsx`

- [ ] **Step 1: Escribir la ruta**

Crea `src/app/api/estados/[id]/route.tsx`:

```tsx
import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { odoo } from "@/lib/odoo";

export const runtime = "nodejs";

const BLUE = "#0851D4";
const GREEN = "#82FE28";

// El logo se lee una vez al cargar el módulo (archivo con espacio en el nombre).
const LOGO_BASE64 = readFileSync(join(process.cwd(), "public", "logo Utilia.jpg")).toString("base64");
const LOGO_SRC = `data:image/jpeg;base64,${LOGO_BASE64}`;

function fmtCOP(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CO");
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await prisma.statusPost.findUnique({ where: { id } });
  if (!post) return new Response("Not found", { status: 404 });

  const img = await odoo.getProductImage(post.odooProductId).catch(() => null);
  const photoSrc = img ? `data:image/png;base64,${img}` : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1080px",
          height: "1920px",
          display: "flex",
          position: "relative",
          backgroundColor: BLUE,
        }}
      >
        {/* Foto o fondo de marca */}
        {photoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoSrc}
            width={1080}
            height={1920}
            style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1920px", objectFit: "cover" }}
            alt=""
          />
        ) : (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "1080px",
              height: "1920px",
              background: `linear-gradient(135deg, ${BLUE}, ${GREEN})`,
            }}
          />
        )}

        {/* Degradado inferior para legibilidad */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "1080px",
            height: "1920px",
            background: "linear-gradient(to top, rgba(4,16,48,0.92) 0%, rgba(4,16,48,0.15) 45%, rgba(0,0,0,0) 68%)",
          }}
        />

        {/* Logo (badge blanco, arriba-izquierda) */}
        <div
          style={{
            position: "absolute",
            top: "48px",
            left: "48px",
            width: "200px",
            height: "200px",
            display: "flex",
            backgroundColor: "#fff",
            borderRadius: "32px",
            padding: "12px",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_SRC} width={176} height={176} style={{ width: "176px", height: "176px", objectFit: "contain" }} alt="Utilia" />
        </div>

        {/* Sello de descuento (verde, arriba-derecha) */}
        <div
          style={{
            position: "absolute",
            top: "56px",
            right: "56px",
            width: "220px",
            height: "220px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: GREEN,
            borderRadius: "110px",
            transform: "rotate(8deg)",
          }}
        >
          <div style={{ display: "flex", fontSize: "84px", fontWeight: 800, color: "#0a2e00" }}>
            -{Math.round(post.discountPct)}%
          </div>
        </div>

        {/* Bloque inferior */}
        <div
          style={{
            position: "absolute",
            left: "56px",
            right: "56px",
            bottom: "72px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", fontSize: "60px", fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>
            {post.productName}
          </div>
          <div style={{ display: "flex", fontSize: "44px", color: "#cbd5e1", textDecoration: "line-through", marginTop: "20px" }}>
            Antes {fmtCOP(post.salePrice)}
          </div>
          <div style={{ display: "flex", fontSize: "140px", fontWeight: 800, color: GREEN, lineHeight: 1 }}>
            {fmtCOP(post.finalPrice)}
          </div>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              marginTop: "28px",
              backgroundColor: BLUE,
              color: "#fff",
              fontSize: "40px",
              fontWeight: 700,
              padding: "16px 32px",
              borderRadius: "40px",
            }}
          >
            {post.copy}
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1920 }
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Verificar en el preview (imagen real)**

Arranca el server de preview (Task 8 explica el detalle) y, con un `id` real de la tabla `StatusPost` (obtenido en el script de Task 3 o desde `npx prisma studio`), abre `http://localhost:3000/api/estados/<ID>` en el navegador.
Expected: se ve un PNG vertical 1080×1920 con foto de fondo, logo arriba-izq, sello verde "-XX%" arriba-der, nombre, precio anterior tachado, precio grande en verde y el copy en pill azul.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/estados/[id]/route.tsx"
git commit -m "feat(estados): ruta /api/estados/[id] que genera el PNG del estado con next/og"
```

---

## Task 6: UI de la sección — `StatusPostsToday.tsx`

**Files:**
- Create: `src/components/dashboard/StatusPostsToday.tsx`

- [ ] **Step 1: Escribir el componente**

Crea `src/components/dashboard/StatusPostsToday.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, RefreshCw, Shuffle, Check } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  swapProductAction,
  regenerateCopyAction,
  updateDiscountAction,
  markPostedAction,
} from "@/app/(dashboard)/liquidacion/status-actions";

export interface StatusPostView {
  id: string;
  slot: number;
  productName: string;
  stockQty: number;
  salePrice: number;
  discountPct: number;
  finalPrice: number;
  copy: string;
  posted: boolean;
  version: number; // updatedAt en ms, para cache-bust de la imagen
}

function StatusCard({ post }: { post: StatusPostView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pct, setPct] = useState(String(Math.round(post.discountPct)));
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

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      {/* Preview: es la imagen real generada */}
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

      {/* Descuento editable */}
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

      {/* Acciones */}
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
          onClick={() => run(() => swapProductAction(post.id), "Producto cambiado")}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          <Shuffle className="h-3.5 w-3.5" /> Cambiar
        </button>
      </div>
    </div>
  );
}

export function StatusPostsToday({ posts }: { posts: StatusPostView[] }) {
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
          <StatusCard key={p.id} post={p} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/StatusPostsToday.tsx
git commit -m "feat(estados): UI de 'Estados de hoy' con preview, descarga y controles"
```

---

## Task 7: Integrar en `/liquidacion`

**Files:**
- Modify: `src/app/(dashboard)/liquidacion/page.tsx`

- [ ] **Step 1: Importar y cargar los estados**

En `src/app/(dashboard)/liquidacion/page.tsx`, agrega los imports arriba (junto a los existentes):

```ts
import { getOrCreateTodayStatusPosts } from "@/lib/analytics/status-posts";
import { StatusPostsToday, type StatusPostView } from "@/components/dashboard/StatusPostsToday";
```

- [ ] **Step 2: Construir la vista serializable dentro del return con productos**

En el bloque `return` final (el que renderiza cuando `analysis.products.length > 0`), justo antes de `<LiquidationWorkspace .../>`, carga y renderiza los estados. Primero, arriba del `return`, agrega la carga:

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
    version: new Date(p.updatedAt).getTime(),
  }));
```

Colócalo justo después de la línea `const tone = {...}[severity];` (antes del `return (`).

- [ ] **Step 3: Renderizar la sección**

Dentro del `return (...)`, inserta `<StatusPostsToday posts={statusView} />` inmediatamente **después** de `<LiquidationGoalEditor ... />` y **antes** de `<LiquidationWorkspace products={analysis.products} />`:

```tsx
      <LiquidationGoalEditor
        goalAmount={goal.goalAmount}
        baseline={goal.baseline}
        currentDeadStock={goal.currentDeadStock}
        updatedAt={goal.updatedAt}
      />

      <StatusPostsToday posts={statusView} />

      <LiquidationWorkspace products={analysis.products} />
```

- [ ] **Step 4: Verificar tipos y build**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run build`
Expected: build exitoso (compila `prisma generate && next build` sin errores).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/liquidacion/page.tsx"
git commit -m "feat(estados): integrar sección 'Estados de hoy' en /liquidacion"
```

---

## Task 8: Verificación manual en el preview + logo asset

**Files:**
- Add: `public/logo Utilia.jpg` (ya está en disco; falta versionarlo)

- [ ] **Step 1: Versionar el logo**

```bash
git add "public/logo Utilia.jpg"
git commit -m "chore(estados): agregar logo de marca para los estados"
```

- [ ] **Step 2: Arrancar el server de preview**

Usa la herramienta de preview (`preview_start` con la config `dev` de `.claude/launch.json`, que corre `next dev`). Si no arranca solo, el comando es `npm run dev` en el puerto 3000.

- [ ] **Step 3: Iniciar sesión y navegar a `/liquidacion`**

Abre la app, inicia sesión y ve a `/liquidacion`.
Expected: aparece la sección "Estados de hoy para WhatsApp" con hasta 3 tarjetas, cada una mostrando la imagen real del estado (foto + logo + precio + sello + copy).

- [ ] **Step 4: Verificar descarga**

Haz clic en "Descargar" en una tarjeta.
Expected: se descarga un PNG `estado-utilia-N.png` 1080×1920 con el diseño correcto.

- [ ] **Step 5: Verificar edición de descuento**

Cambia el % a otro valor y pulsa "Aplicar".
Expected: toast "Descuento actualizado"; la imagen del preview se actualiza con el nuevo % y precio (el cache-bust `?v=` cambia tras `router.refresh()`).

- [ ] **Step 6: Verificar regenerar texto y cambiar producto**

Pulsa "Texto" (regenera copy) y "Cambiar" (trae otro producto).
Expected: toasts de éxito; el preview refleja el nuevo copy / nuevo producto.

- [ ] **Step 7: Verificar marcar publicado**

Pulsa "Marcar".
Expected: la tarjeta muestra el overlay "Publicado"; volver a pulsar lo revierte.

- [ ] **Step 8: Revisar errores**

Revisa la consola del navegador y los logs del server de preview.
Expected: sin errores rojos. (Los 3 estados se generan con 3 llamadas a `gpt-4o-mini` la primera vez del día; luego se leen de la BD.)

- [ ] **Step 9: Chequeo mobile**

Redimensiona el preview a mobile (375px).
Expected: las 3 tarjetas pasan a 1 columna, la imagen mantiene proporción 9:16, los controles siguen usables.

- [ ] **Step 10: Detener el preview**

Detén el server de preview.

- [ ] **Step 11: Merge / PR**

Con todo verde, seguir la skill `superpowers:finishing-a-development-branch` para abrir el PR de la rama `feat/estados-liquidacion-whatsapp`.

---

## Self-Review (cobertura del spec)

- **Publicación asistida (sin API):** la ruta genera PNG y la UI ofrece descarga manual; no hay envío automático. ✓ (Tasks 5, 6)
- **Selección 3/día por capital invertido, sin repetir:** `getOrCreateTodayStatusPosts` + `rankedDeadStock` + `recentlyPostedIds`. ✓ (Task 3)
- **Descuento escalonado >60→30, 31–60→20, editable:** `discountForRotation` + `updateStatusPostDiscount`. ✓ (Tasks 3, 4, 6)
- **Copy IA con fallback:** `generateCopy` + `fallbackCopy`. ✓ (Task 3)
- **Foto de Odoo con fallback gráfico:** `odoo.getProductImage` + rama sin-foto en la ruta. ✓ (Tasks 2, 5)
- **Estilo A con logo/colores de marca 1080×1920:** JSX de `ImageResponse`. ✓ (Task 5)
- **Sección dentro de /liquidacion:** integración en `page.tsx`. ✓ (Task 7)
- **Persistencia StatusPost:** modelo + unique [date,slot]. ✓ (Task 1)
- **Manejo de errores (IA/Odoo/pocos productos):** try/catch en copy, `.catch(()=>null)` en foto, `pool<SLOTS` reinicia, `posts.length===0` no renderiza. ✓
```
