# Plantillas A/B/C para los Estados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir elegir por estado una de tres plantillas visuales (A/B/C) y que la imagen del estado se construya con esa plantilla.

**Architecture:** Se agrega un campo `template` a `StatusPost`. Las 3 composiciones de imagen se aíslan en un módulo `templates.tsx` (funciones que devuelven JSX de Satori); la ruta `/api/estados/[id]` prepara foto+logo y despacha a `renderEstado(template, data)`. La UI de cada tarjeta gana un selector A/B/C que, vía server action, persiste la plantilla y reconstruye la imagen.

**Tech Stack:** Next.js 15 (`next/og`/Satori, Node runtime), Prisma 6 (Postgres, `db push` bloqueado → SQL directo), sharp (WebP→PNG), React 19, Tailwind, sonner.

**Base:** Esta rama parte de `feat/estados-plantillas-abc`, que incluye la reubicación de la sección a `/campanas` (PR #19). Las server actions viven en `src/app/(dashboard)/campanas/status-actions.ts`.

**Convención:** Sin framework de tests; verificación con `npx tsc --noEmit` + preview manual (screenshots de A/B/C).

---

## File Structure

- Modify: `prisma/schema.prisma` — campo `template` en `StatusPost`.
- Create: `src/app/api/estados/[id]/templates.tsx` — renderers A/B/C + `renderEstado`.
- Modify: `src/app/api/estados/[id]/route.tsx` — usa `renderEstado`, valida `template`.
- Modify: `src/lib/analytics/status-posts.ts` — `updateStatusPostTemplate`.
- Modify: `src/app/(dashboard)/campanas/status-actions.ts` — `setTemplateAction`.
- Modify: `src/components/dashboard/StatusPostsToday.tsx` — `template` en la vista + selector A/B/C.
- Modify: `src/app/(dashboard)/campanas/page.tsx` — mapear `template` a la vista.

---

## Task 1: Campo `template` en `StatusPost`

**Files:** Modify `prisma/schema.prisma`

- [ ] **Step 1: Agregar el campo al modelo**

En `prisma/schema.prisma`, dentro de `model StatusPost`, agrega la línea `template` justo después de `copy`:

```prisma
  copy          String                       // línea de urgencia (IA)
  template      String    @default("A")       // "A" | "B" | "C"
```

- [ ] **Step 2: Aplicar la columna con SQL directo (db push está bloqueado)**

Crea `scripts/tmp-add-template.ts`:

```ts
import { prisma } from "@/lib/prisma";
async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "StatusPost" ADD COLUMN IF NOT EXISTS "template" TEXT NOT NULL DEFAULT 'A'`
  );
  const check = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_name='StatusPost' AND column_name='template'`
  );
  console.log("columna template existe? →", check.length > 0);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
```

Run: `npx tsx --env-file=.env.local scripts/tmp-add-template.ts`
Expected: `columna template existe? → true`

- [ ] **Step 3: Regenerar el cliente y verificar tipos**

Run: `npx prisma generate`
Expected: "Generated Prisma Client".

Run: `npx tsc --noEmit`
Expected: sin errores (confirma que `post.template` tipa como `string`).

- [ ] **Step 4: Borrar el script y commit**

```bash
rm scripts/tmp-add-template.ts
git add prisma/schema.prisma
git commit -m "feat(estados): campo template (A/B/C) en StatusPost"
```

---

## Task 2: Módulo de plantillas — `templates.tsx`

**Files:** Create `src/app/api/estados/[id]/templates.tsx`

- [ ] **Step 1: Escribir el módulo completo**

Crea `src/app/api/estados/[id]/templates.tsx`:

```tsx
import type { ReactElement } from "react";

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

const BLUE = "#0851D4";
const GREEN = "#82FE28";

function fmtCOP(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CO");
}

// A — Impacto máximo (foto a sangre completa)
function TemplateA(d: EstadoData): ReactElement {
  return (
    <div style={{ width: "1080px", height: "1920px", display: "flex", position: "relative", backgroundColor: BLUE }}>
      {d.photoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.photoSrc} width={1080} height={1920} style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1920px", objectFit: "cover" }} alt="" />
      ) : (
        <div style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1920px", background: `linear-gradient(135deg, ${BLUE}, ${GREEN})` }} />
      )}
      <div style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1920px", background: "linear-gradient(to top, rgba(4,16,48,0.92) 0%, rgba(4,16,48,0.15) 45%, rgba(0,0,0,0) 68%)" }} />
      <div style={{ position: "absolute", top: "48px", left: "48px", width: "200px", height: "200px", display: "flex", backgroundColor: "#fff", borderRadius: "32px", padding: "12px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.logoSrc} width={176} height={176} style={{ width: "176px", height: "176px", objectFit: "contain" }} alt="Utilia" />
      </div>
      <div style={{ position: "absolute", top: "56px", right: "56px", width: "220px", height: "220px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: GREEN, borderRadius: "110px", transform: "rotate(8deg)" }}>
        <div style={{ display: "flex", fontSize: "84px", fontWeight: 800, color: "#0a2e00" }}>-{Math.round(d.discountPct)}%</div>
      </div>
      <div style={{ position: "absolute", left: "56px", right: "56px", bottom: "72px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: "60px", fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>{d.productName}</div>
        <div style={{ display: "flex", fontSize: "44px", color: "#cbd5e1", textDecoration: "line-through", marginTop: "20px" }}>Antes {fmtCOP(d.salePrice)}</div>
        <div style={{ display: "flex", fontSize: "140px", fontWeight: 800, color: GREEN, lineHeight: 1 }}>{fmtCOP(d.finalPrice)}</div>
        <div style={{ display: "flex", alignSelf: "flex-start", marginTop: "28px", backgroundColor: BLUE, color: "#fff", fontSize: "40px", fontWeight: 700, padding: "16px 32px", borderRadius: "40px" }}>{d.copy}</div>
      </div>
    </div>
  );
}

// B — Banda azul de marca (foto arriba, banda inferior)
function TemplateB(d: EstadoData): ReactElement {
  return (
    <div style={{ width: "1080px", height: "1920px", display: "flex", position: "relative", backgroundColor: BLUE }}>
      {d.photoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.photoSrc} width={1080} height={1075} style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1075px", objectFit: "cover" }} alt="" />
      ) : (
        <div style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1075px", background: `linear-gradient(135deg, ${BLUE}, ${GREEN})` }} />
      )}
      <div style={{ position: "absolute", left: 0, bottom: 0, width: "1080px", height: "845px", backgroundColor: BLUE, display: "flex", flexDirection: "column", justifyContent: "center", padding: "72px" }}>
        <div style={{ display: "flex", fontSize: "60px", fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>{d.productName}</div>
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: "28px" }}>
          <div style={{ display: "flex", fontSize: "44px", color: "#c7d2fe", textDecoration: "line-through", marginRight: "24px" }}>{fmtCOP(d.salePrice)}</div>
          <div style={{ display: "flex", fontSize: "128px", fontWeight: 800, color: GREEN, lineHeight: 1 }}>{fmtCOP(d.finalPrice)}</div>
        </div>
        <div style={{ display: "flex", fontSize: "44px", fontWeight: 700, color: GREEN, marginTop: "24px" }}>{d.copy}</div>
      </div>
      <div style={{ position: "absolute", top: "1000px", left: "72px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: GREEN, color: "#0a2e00", fontSize: "56px", fontWeight: 800, padding: "18px 40px", borderRadius: "20px", transform: "rotate(-4deg)" }}>-{Math.round(d.discountPct)}% HOY</div>
      <div style={{ position: "absolute", top: "48px", left: "48px", width: "210px", height: "210px", display: "flex", backgroundColor: "#fff", borderRadius: "32px", padding: "12px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.logoSrc} width={186} height={186} style={{ width: "186px", height: "186px", objectFit: "contain" }} alt="Utilia" />
      </div>
    </div>
  );
}

// C — Limpio / editorial (fondo blanco, foto enmarcada)
function TemplateC(d: EstadoData): ReactElement {
  return (
    <div style={{ width: "1080px", height: "1920px", display: "flex", position: "relative", backgroundColor: "#ffffff" }}>
      {d.photoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.photoSrc} width={968} height={1000} style={{ position: "absolute", top: "56px", left: "56px", width: "968px", height: "1000px", objectFit: "cover", borderRadius: "24px" }} alt="" />
      ) : (
        <div style={{ position: "absolute", top: "56px", left: "56px", width: "968px", height: "1000px", borderRadius: "24px", background: `linear-gradient(135deg, ${BLUE}, ${GREEN})` }} />
      )}
      <div style={{ position: "absolute", left: "56px", right: "56px", bottom: "64px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.logoSrc} width={96} height={96} style={{ width: "96px", height: "96px", objectFit: "contain", marginRight: "20px" }} alt="Utilia" />
          <div style={{ display: "flex", fontSize: "34px", fontWeight: 800, color: BLUE, letterSpacing: "4px" }}>LIQUIDACIÓN</div>
        </div>
        <div style={{ display: "flex", fontSize: "58px", fontWeight: 700, color: "#111111", lineHeight: 1.1, marginTop: "24px" }}>{d.productName}</div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: "40px", color: "#9ca3af", textDecoration: "line-through" }}>{fmtCOP(d.salePrice)}</div>
            <div style={{ display: "flex", fontSize: "120px", fontWeight: 800, color: BLUE, lineHeight: 1 }}>{fmtCOP(d.finalPrice)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: GREEN, color: "#0a2e00", fontSize: "56px", fontWeight: 900, padding: "16px 32px", borderRadius: "20px" }}>-{Math.round(d.discountPct)}%</div>
        </div>
        <div style={{ display: "flex", fontSize: "40px", fontWeight: 800, color: BLUE, marginTop: "24px" }}>{d.copy}</div>
      </div>
    </div>
  );
}

export function renderEstado(template: TemplateId, d: EstadoData): ReactElement {
  if (template === "B") return TemplateB(d);
  if (template === "C") return TemplateC(d);
  return TemplateA(d);
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/estados/[id]/templates.tsx"
git commit -m "feat(estados): plantillas A/B/C como renderers de Satori"
```

---

## Task 3: Ruta usa `renderEstado`

**Files:** Modify `src/app/api/estados/[id]/route.tsx`

- [ ] **Step 1: Reemplazar el contenido completo del archivo**

Reemplaza TODO `src/app/api/estados/[id]/route.tsx` por:

```tsx
import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { odoo } from "@/lib/odoo";
import { renderEstado, type TemplateId } from "./templates";

export const runtime = "nodejs";

// El logo se lee una vez al cargar el módulo (archivo con espacio en el nombre).
const LOGO_BASE64 = readFileSync(join(process.cwd(), "public", "logo Utilia.jpg")).toString("base64");
const LOGO_SRC = `data:image/jpeg;base64,${LOGO_BASE64}`;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await prisma.statusPost.findUnique({ where: { id } });
  if (!post) return new Response("Not found", { status: 404 });

  // Odoo entrega las imágenes en WebP, que Satori (next/og) no decodifica.
  // Las normalizamos a PNG con sharp (que detecta el formato de entrada solo).
  const img = await odoo.getProductImage(post.odooProductId).catch(() => null);
  let photoSrc: string | null = null;
  if (img) {
    try {
      const png = await sharp(Buffer.from(img, "base64")).png().toBuffer();
      photoSrc = `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      photoSrc = null;
    }
  }

  const template: TemplateId = post.template === "B" || post.template === "C" ? post.template : "A";

  return new ImageResponse(
    renderEstado(template, {
      productName: post.productName,
      salePrice: post.salePrice,
      finalPrice: post.finalPrice,
      discountPct: post.discountPct,
      copy: post.copy,
      photoSrc,
      logoSrc: LOGO_SRC,
    }),
    { width: 1080, height: 1920 }
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/estados/[id]/route.tsx"
git commit -m "feat(estados): la ruta despacha a la plantilla elegida"
```

---

## Task 4: `updateStatusPostTemplate` en la lógica

**Files:** Modify `src/lib/analytics/status-posts.ts`

- [ ] **Step 1: Agregar la función al final del archivo**

Al final de `src/lib/analytics/status-posts.ts`, agrega:

```ts
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
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/status-posts.ts
git commit -m "feat(estados): updateStatusPostTemplate"
```

---

## Task 5: Server action `setTemplateAction`

**Files:** Modify `src/app/(dashboard)/campanas/status-actions.ts`

- [ ] **Step 1: Importar la función y agregar la acción**

En `src/app/(dashboard)/campanas/status-actions.ts`, agrega `updateStatusPostTemplate` a la lista de imports desde `@/lib/analytics/status-posts`:

```ts
import {
  swapStatusPostProduct,
  regenerateStatusPostCopy,
  updateStatusPostDiscount,
  markStatusPostPosted,
  updateStatusPostTemplate,
} from "@/lib/analytics/status-posts";
```

Y agrega esta acción al final del archivo:

```ts
export async function setTemplateAction(id: string, template: string) {
  try {
    await requireSession();
    if (template !== "A" && template !== "B" && template !== "C") {
      return { ok: false as const, error: "Plantilla inválida" };
    }
    await updateStatusPostTemplate(id, template);
    revalidatePath("/campanas");
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
git add "src/app/(dashboard)/campanas/status-actions.ts"
git commit -m "feat(estados): server action setTemplateAction"
```

---

## Task 6: Selector A/B/C en la UI

**Files:** Modify `src/components/dashboard/StatusPostsToday.tsx`, `src/app/(dashboard)/campanas/page.tsx`

- [ ] **Step 1: Importar `setTemplateAction`**

En `src/components/dashboard/StatusPostsToday.tsx`, agrega `setTemplateAction` a los imports de acciones:

```ts
import {
  swapProductAction,
  regenerateCopyAction,
  updateDiscountAction,
  markPostedAction,
  setTemplateAction,
} from "@/app/(dashboard)/campanas/status-actions";
```

- [ ] **Step 2: Agregar `template` a la interfaz `StatusPostView`**

En la misma interfaz, agrega el campo después de `posted`:

```ts
  posted: boolean;
  template: "A" | "B" | "C";
  version: number; // updatedAt en ms, para cache-bust de la imagen
```

- [ ] **Step 3: Renderizar el selector A/B/C en la tarjeta**

En `StatusCard`, inserta este bloque JUSTO ANTES del `<div className="flex items-center gap-1.5">` que contiene el input de descuento (el que empieza con `<span className="text-xs text-muted-foreground">Desc.</span>`):

```tsx
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

```

- [ ] **Step 4: Mapear `template` en la página de campañas**

En `src/app/(dashboard)/campanas/page.tsx`, dentro del `.map((p) => ({ ... }))` que arma `statusView`, agrega el campo `template` después de `posted`:

```ts
    posted: p.posted,
    template: p.template as "A" | "B" | "C",
    version: new Date(p.updatedAt).getTime(),
```

- [ ] **Step 5: Verificar tipos y build**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 6: Commit**

```bash
git add "src/components/dashboard/StatusPostsToday.tsx" "src/app/(dashboard)/campanas/page.tsx"
git commit -m "feat(estados): selector de plantilla A/B/C en cada tarjeta"
```

---

## Task 7: Verificación en preview (A/B/C)

**Files:** ninguno (verificación)

- [ ] **Step 1: Arrancar el preview**

Arranca el server de preview (`preview_start`, config `utilia-dev`, `next dev` en puerto 3000).

- [ ] **Step 2: Obtener un id real y probar las 3 plantillas**

Con un `id` real de `StatusPost` (desde `prisma studio` o un script), y usando la BD directamente para fijar la plantilla (o el selector de la UI si ya hay sesión), abre en el navegador:
- `http://localhost:3000/api/estados/<ID>` con `template='A'` → verifica estilo A.
- Fija `template='B'` (vía el selector A/B/C en `/campanas`, o `UPDATE "StatusPost" SET template='B'`) y recarga `/api/estados/<ID>` → verifica estilo B (foto arriba, banda azul abajo, sello verde, precio verde lima).
- Igual para `template='C'` → verifica estilo C (fondo blanco, foto enmarcada, logo+"LIQUIDACIÓN", precio azul, pill verde).

Capturar screenshot de cada una.
Expected: las 3 imágenes 1080×1920 se ven completas y fieles a los mockups; el texto no se desborda; el sello/precio/copy legibles.

- [ ] **Step 3: Verificar el selector en la UI**

En `/campanas`, en una tarjeta, hacer clic en B y luego C.
Expected: toast "Plantilla B"/"Plantilla C"; el botón activo se resalta; el preview de la tarjeta (imagen real) se actualiza a la plantilla elegida.

- [ ] **Step 4: Revisar errores y detener**

Revisar consola del navegador y logs del server (sin errores de Satori). Detener el preview.

- [ ] **Step 5: Merge / PR**

Con todo verde, seguir `superpowers:finishing-a-development-branch`.

---

## Self-Review (cobertura del spec)

- **Selección por estado + persistencia:** campo `template` + `updateStatusPostTemplate` + selector por tarjeta. ✓ (Tasks 1, 4, 6)
- **Default A:** `@default("A")` en schema + `DEFAULT 'A'` en el ALTER + fallback en la ruta. ✓ (Tasks 1, 3)
- **Implementar B y C en Satori:** `templates.tsx` con TemplateB/TemplateC. ✓ (Task 2)
- **Ruta despacha por plantilla:** `renderEstado(template, data)` con validación. ✓ (Task 3)
- **Server action validada:** `setTemplateAction` valida A/B/C. ✓ (Task 5)
- **UI actualiza y reconstruye:** selector → acción → `router.refresh` → cache-bust por `updatedAt`. ✓ (Task 6)
- **Manejo de errores:** template inválido → A (ruta y acción). ✓ (Tasks 3, 5)
- **Testing:** screenshots A/B/C en preview. ✓ (Task 7)
```
