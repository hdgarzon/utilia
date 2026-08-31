# Módulo de Reabastecimiento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir el ciclo de compra a: revisar pedido sugerido por proveedor → aprobar (crea borrador de `purchase.order` en Odoo) → enviar WhatsApp → validar recepción en Odoo; Utilia cierra el ciclo con el sync diario.

**Architecture:** Motor de sugerencias por producto (`src/lib/analytics/replenishment.ts`) que agrupa por proveedor inferido del historial de `PurchaseOrder`; directorio `Supplier` con override manual por producto; página `/reabastecimiento` con server actions; escritura a Odoo aislada en `src/lib/odoo-write.ts` (solo borradores, solo por acción del usuario); `syncPurchases` gana la captura de `odooPartnerId` y el cierre automático de pedidos recibidos.

**Tech Stack:** Next.js 15 App Router (RSC + server actions), Prisma 6 + Postgres Supabase (`db push` bloqueado → SQL directo), Odoo JSON-RPC, Tailwind + lucide + sonner, zod.

**Spec:** `docs/superpowers/specs/2026-08-31-reabastecimiento-design.md` — leerla antes de empezar.

**Base:** Crear la rama `feat/reabastecimiento` desde `feat/estados-plantillas-abc` (contiene la spec). El working tree tiene WIP ajeno a este plan en `src/app/(dashboard)/page.tsx`, `src/components/dashboard/AIFeed.tsx`, `src/components/dashboard/KPICard.tsx` y `src/lib/analytics/opportunities.ts`: **no tocar ni stagear esos archivos**. La tarjeta-resumen del dashboard queda explícitamente fuera de este plan (se integrará cuando ese WIP se mergee).

**Convención de verificación:** Sin framework de tests en el repo. Cada pieza de lógica se verifica con un script temporal `scripts/tmp-*.ts` (se borra antes del commit), `npx tsc --noEmit` para tipos, y verificación manual en el navegador para UI. La BD es la de producción: los scripts temporales de verificación son de solo lectura salvo el de migración (Task 1) y el de backfill (Task 2).

## Global Constraints

- Commits en español, sin tildes, formato `scope(area): resumen` (ej: `feat(reabastecimiento): motor de sugerencias`). Prohibido mencionar IA/asistentes o agregar `Co-Authored-By` en cualquier artefacto.
- `git add` siempre con rutas explícitas. Jamás `git add -A` / `git add .`. Jamás stagear `.env*`, los 4 archivos WIP listados arriba, ni scripts `tmp-*`.
- Odoo es upstream: ningún job de sync ni cron escribe en Odoo. La única escritura permitida es `createDraftPurchaseOrder` desde server actions disparadas por el usuario.
- Nada de datos reales (nombres de proveedores/clientes, cifras) en código, comentarios o docs; valores de ejemplo obviamente falsos.
- Fechas: usar helpers de `src/lib/timezone.ts` cuando aplique zona Colombia; aritmética simple en ms está bien para "días transcurridos".
- Cambios de esquema: SQL directo con script temporal + `npx prisma generate` (`prisma db push` está bloqueado por FK cross-schema de la BD compartida).
- `npm run build` corre `prisma generate` primero; tras cambiar el schema, regenerar antes de `tsc`.

---

## File Structure

- Modify: `prisma/schema.prisma` — modelos `Supplier`, `ProductSupplierOverride`, `ReplenishmentOrder`, `ReplenishmentLine`, enum `ReplenishmentStatus`; columna `odooPartnerId` en `PurchaseOrder`.
- Modify: `src/lib/sync.ts` — captura de `odooPartnerId` en compras + cierre de ciclo de reabastecimiento.
- Create: `src/lib/suppliers.ts` — `ensureSuppliersFromHistory`, `importSuppliersFromOdoo`.
- Modify: `src/lib/odoo.ts` — lectura `getSuppliers()`; nota de uso en `odooRpc`.
- Create: `src/lib/analytics/replenishment.ts` — tipos + `computeSuggestedQty` (pura) + `getReplenishmentPlan`.
- Create: `src/lib/whatsapp.ts` — `normalizePhoneForWhatsApp`, `buildOrderMessage`, `buildWaLink` (puras).
- Create: `src/lib/odoo-write.ts` — `createDraftPurchaseOrder` (única escritura a Odoo).
- Create: `src/app/(dashboard)/reabastecimiento/actions.ts` — server actions.
- Create: `src/app/(dashboard)/reabastecimiento/page.tsx` — página (RSC).
- Create: `src/components/dashboard/ReplenishmentBoard.tsx` — tarjetas por proveedor (client).
- Create: `src/components/dashboard/ReplenishmentPending.tsx` — pedidos en curso (client).
- Modify: `src/components/layout/nav-config.tsx` — entrada de sidebar.
- Modify: `src/app/(dashboard)/inventario/page.tsx` — enlace "Generar pedido".
- Modify: `src/app/(dashboard)/compras/page.tsx` — enlace a `/reabastecimiento`.

---

## Task 1: Rama + esquema (modelos nuevos y columna en PurchaseOrder)

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: modelos Prisma `Supplier`, `ProductSupplierOverride`, `ReplenishmentOrder` (+enum `ReplenishmentStatus`), `ReplenishmentLine`; campo `PurchaseOrder.odooPartnerId: Int?`. Todas las tasks posteriores usan `prisma.supplier`, `prisma.productSupplierOverride`, `prisma.replenishmentOrder`, `prisma.replenishmentLine`.

- [ ] **Step 1: Crear la rama**

```bash
git checkout -b feat/reabastecimiento
```

- [ ] **Step 2: Agregar los modelos al schema**

En `prisma/schema.prisma`, dentro de `model PurchaseOrder`, agrega `odooPartnerId` justo después de `partnerName`:

```prisma
  partnerName   String?
  odooPartnerId Int? // res.partner id del proveedor — permite crear ordenes desde Utilia
```

Al final del archivo (después de `StatusPost`), agrega la sección completa:

```prisma
// ─── Reabastecimiento (pedidos a proveedor) ───────────────────────────────────

model Supplier {
  id            String                    @id @default(cuid())
  name          String                    @unique // matchea PurchaseOrder.partnerName
  odooPartnerId Int?                      @unique // necesario para crear la orden en Odoo
  phone         String? // WhatsApp, editable en UI
  notes         String?
  active        Boolean                   @default(true)
  orders        ReplenishmentOrder[]
  overrides     ProductSupplierOverride[]
  createdAt     DateTime                  @default(now())
  updatedAt     DateTime                  @updatedAt
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
  odooOrderName  String? // ej "P00123"
  totalEstimated Float               @default(0) // suma qty × unitCost al aprobar
  sentAt         DateTime? // clic en WhatsApp / marcado manual
  receivedAt     DateTime? // detectado por el sync
  lines          ReplenishmentLine[]
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  @@index([status])
}

enum ReplenishmentStatus {
  APPROVED // aprobado en Utilia; borrador creado (o pendiente de crear) en Odoo
  SENT // pedido enviado al proveedor
  RECEIVED // orden confirmada/recibida en Odoo (la detecta el sync)
  CANCELLED
}

model ReplenishmentLine {
  id            String             @id @default(cuid())
  order         ReplenishmentOrder @relation(fields: [orderId], references: [id], onDelete: Cascade)
  orderId       String
  odooProductId Int
  productName   String
  qty           Float // cantidad final aprobada por el usuario
  suggestedQty  Float // lo que sugirio el motor
  unitCost      Float // CMP al momento de aprobar
  reason        String // "critico" | "advertencia" | "min_stock"

  @@index([orderId])
  @@index([odooProductId])
}
```

- [ ] **Step 3: Aplicar con SQL directo**

Crea `scripts/tmp-replenishment-schema.ts`:

```ts
import { prisma } from "../src/lib/prisma";

async function main() {
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "ReplenishmentStatus" AS ENUM ('APPROVED','SENT','RECEIVED','CANCELLED');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Supplier" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "odooPartnerId" INTEGER,
      "phone" TEXT,
      "notes" TEXT,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_name_key" ON "Supplier"("name")`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_odooPartnerId_key" ON "Supplier"("odooPartnerId")`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProductSupplierOverride" (
      "odooProductId" INTEGER PRIMARY KEY,
      "supplierId" TEXT NOT NULL REFERENCES "Supplier"("id"),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ReplenishmentOrder" (
      "id" TEXT PRIMARY KEY,
      "supplierId" TEXT NOT NULL REFERENCES "Supplier"("id"),
      "status" "ReplenishmentStatus" NOT NULL DEFAULT 'APPROVED',
      "odooOrderId" INTEGER,
      "odooOrderName" TEXT,
      "totalEstimated" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "sentAt" TIMESTAMP(3),
      "receivedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ReplenishmentOrder_odooOrderId_key" ON "ReplenishmentOrder"("odooOrderId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ReplenishmentOrder_status_idx" ON "ReplenishmentOrder"("status")`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ReplenishmentLine" (
      "id" TEXT PRIMARY KEY,
      "orderId" TEXT NOT NULL REFERENCES "ReplenishmentOrder"("id") ON DELETE CASCADE,
      "odooProductId" INTEGER NOT NULL,
      "productName" TEXT NOT NULL,
      "qty" DOUBLE PRECISION NOT NULL,
      "suggestedQty" DOUBLE PRECISION NOT NULL,
      "unitCost" DOUBLE PRECISION NOT NULL,
      "reason" TEXT NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ReplenishmentLine_orderId_idx" ON "ReplenishmentLine"("orderId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ReplenishmentLine_odooProductId_idx" ON "ReplenishmentLine"("odooProductId")`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "odooPartnerId" INTEGER`);

  const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables WHERE table_name IN ('Supplier','ProductSupplierOverride','ReplenishmentOrder','ReplenishmentLine')`
  );
  const col = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_name='PurchaseOrder' AND column_name='odooPartnerId'`
  );
  console.log("tablas creadas →", tables.map((t) => t.table_name).sort().join(", "));
  console.log("PurchaseOrder.odooPartnerId existe? →", col.length > 0);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
```

Run: `npx tsx --env-file=.env.local scripts/tmp-replenishment-schema.ts`
Expected: las 4 tablas listadas y `PurchaseOrder.odooPartnerId existe? → true`

- [ ] **Step 4: Regenerar cliente y verificar tipos**

Run: `npx prisma generate`
Expected: "Generated Prisma Client"

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 5: Borrar script temporal y commit**

```bash
rm scripts/tmp-replenishment-schema.ts
git add prisma/schema.prisma
git commit -m "feat(reabastecimiento): modelos Supplier y ReplenishmentOrder, partner id en compras"
```

---

## Task 2: Sync — capturar `odooPartnerId`, backfill y cierre de ciclo

**Files:**
- Modify: `src/lib/sync.ts` (función `upsertPurchaseOrder` ~línea 193 y `syncPurchases` ~línea 220)

**Interfaces:**
- Consumes: columna `PurchaseOrder.odooPartnerId` (Task 1); `OdooPurchaseOrder.partner_id: [number, string] | false` (ya existe en `src/lib/odoo.ts`).
- Produces: `PurchaseOrder.odooPartnerId` poblado en cada sync (fuente de la inferencia de proveedor en Task 4); pedidos `APPROVED`/`SENT` pasan a `RECEIVED` cuando su orden aparece confirmada en Odoo.

- [ ] **Step 1: Agregar `odooPartnerId` al upsert**

En `src/lib/sync.ts`, en la firma de `upsertPurchaseOrder`, agrega el campo al tipo del parámetro `order` (después de `partnerName: string | null;`):

```ts
    partnerName: string | null;
    odooPartnerId: number | null;
```

Y en `syncPurchases`, dentro del `for (const o of orders)`, en el objeto que se pasa a `upsertPurchaseOrder`, agrega después de `partnerName`:

```ts
          partnerName: o.partner_id ? o.partner_id[1] : null,
          odooPartnerId: o.partner_id ? o.partner_id[0] : null,
```

- [ ] **Step 2: Agregar el cierre de ciclo al final de `syncPurchases`**

En `syncPurchases`, justo después del cierre del `for (const o of orders)` y ANTES de `await recordSyncSuccess("purchase_order", runStart);`, agrega:

```ts
    // Cierre de ciclo de reabastecimiento: si una orden creada desde Utilia ya
    // aparece confirmada en Odoo (state purchase/done → entró al sync), el
    // pedido pasa a RECIBIDO. Falla suave: un error aquí no tumba el sync.
    try {
      await prisma.$executeRaw`
        UPDATE "ReplenishmentOrder" r
        SET status = 'RECEIVED', "receivedAt" = p."dateOrder", "updatedAt" = now()
        FROM "PurchaseOrder" p
        WHERE p."odooOrderId" = r."odooOrderId"
          AND r.status IN ('APPROVED', 'SENT')
      `;
    } catch (err) {
      console.warn("[sync] cierre de reabastecimiento fallo:", err);
    }
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 4: Backfill del historial**

El sync incremental solo trae órdenes nuevas; para poblar `odooPartnerId` en el historial hay que resetear el cursor. Crea `scripts/tmp-backfill-partner.ts`:

```ts
import { prisma } from "../src/lib/prisma";

async function main() {
  const res = await prisma.syncState.updateMany({
    where: { entity: "purchase_order" },
    data: { lastSyncAt: new Date(0) },
  });
  console.log("cursor de purchase_order reseteado →", res.count === 1);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
```

Run: `npx tsx --env-file=.env.local scripts/tmp-backfill-partner.ts`
Expected: `cursor de purchase_order reseteado → true`

Run: `npm run sync`
Expected: termina sin error (el job de compras re-trae todas las órdenes confirmadas)

- [ ] **Step 5: Verificar el backfill**

Crea `scripts/tmp-verify-partner.ts` (solo lectura):

```ts
import { prisma } from "../src/lib/prisma";

async function main() {
  const total = await prisma.purchaseOrder.count();
  const withPartner = await prisma.purchaseOrder.count({ where: { odooPartnerId: { not: null } } });
  console.log(`ordenes: ${total} · con odooPartnerId: ${withPartner}`);
  console.log("backfill ok? →", total > 0 && withPartner === total);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
```

Run: `npx tsx --env-file=.env.local scripts/tmp-verify-partner.ts`
Expected: `backfill ok? → true` (si alguna orden antigua de Odoo no tiene partner, `withPartner` puede ser menor; aceptable si la diferencia es de pocas órdenes — anotarlo en el commit)

- [ ] **Step 6: Borrar scripts temporales y commit**

```bash
rm scripts/tmp-backfill-partner.ts scripts/tmp-verify-partner.ts
git add src/lib/sync.ts
git commit -m "feat(reabastecimiento): partner id en sync de compras y cierre de pedidos recibidos"
```

---

## Task 3: Directorio de proveedores — `src/lib/suppliers.ts` + lectura Odoo

**Files:**
- Create: `src/lib/suppliers.ts`
- Modify: `src/lib/odoo.ts` (agregar `getSuppliers` al objeto `odoo`, después de `getPartners`)

**Interfaces:**
- Consumes: `prisma.supplier` (Task 1); `PurchaseOrder.odooPartnerId` poblado (Task 2).
- Produces: `ensureSuppliersFromHistory(): Promise<number>` (número de proveedores creados) y `importSuppliersFromOdoo(): Promise<{ created: number; phonesFilled: number }>`; `odoo.getSuppliers(): Promise<OdooSupplier[]>` con `OdooSupplier = { id: number; name: string; phone: string | false; mobile: string | false }`.

- [ ] **Step 1: Agregar `getSuppliers` a `src/lib/odoo.ts`**

Después del tipo `OdooPartner`, agrega:

```ts
export interface OdooSupplier {
  id: number;
  name: string;
  phone: string | false;
  mobile: string | false;
}
```

Dentro del objeto `odoo`, después de `getPartners`, agrega:

```ts
  /** Contactos marcados como proveedor (supplier_rank > 0). Solo lectura. */
  async getSuppliers(): Promise<OdooSupplier[]> {
    return searchRead<OdooSupplier>(
      "res.partner",
      [["supplier_rank", ">", 0]],
      ["id", "name", "phone", "mobile"],
      { limit: 1000, order: "name asc" }
    );
  },
```

- [ ] **Step 2: Crear `src/lib/suppliers.ts`**

```ts
import { prisma } from "@/lib/prisma";
import { odoo } from "@/lib/odoo";

/**
 * Crea proveedores a partir del historial de compras sincronizado. Idempotente:
 * upsert por odooPartnerId. El nombre se refresca desde Odoo (partnerName);
 * el teléfono NUNCA se toca aquí (es dato capturado a mano en Utilia).
 */
export async function ensureSuppliersFromHistory(): Promise<number> {
  const partners = await prisma.$queryRaw<Array<{ odooPartnerId: number; partnerName: string | null }>>`
    SELECT DISTINCT ON ("odooPartnerId") "odooPartnerId", "partnerName"
    FROM "PurchaseOrder"
    WHERE "odooPartnerId" IS NOT NULL
    ORDER BY "odooPartnerId", "dateOrder" DESC
  `;

  let created = 0;
  for (const p of partners) {
    const name = p.partnerName ?? `Proveedor ${p.odooPartnerId}`;
    try {
      const existing = await prisma.supplier.findUnique({ where: { odooPartnerId: p.odooPartnerId } });
      if (!existing) {
        await prisma.supplier.create({ data: { name, odooPartnerId: p.odooPartnerId } });
        created++;
      } else if (existing.name !== name) {
        await prisma.supplier.update({ where: { id: existing.id }, data: { name } });
      }
    } catch {
      // Colisión por nombre duplicado (name es @unique): se conserva el existente.
    }
  }
  return created;
}

/**
 * Trae los contactos proveedor de Odoo y completa el directorio: crea los que
 * falten y rellena el teléfono SOLO si está vacío (no pisa capturas manuales).
 */
export async function importSuppliersFromOdoo(): Promise<{ created: number; phonesFilled: number }> {
  const odooSuppliers = await odoo.getSuppliers();
  let created = 0;
  let phonesFilled = 0;

  for (const s of odooSuppliers) {
    const phone = (typeof s.mobile === "string" && s.mobile) || (typeof s.phone === "string" && s.phone) || null;
    try {
      const existing = await prisma.supplier.findUnique({ where: { odooPartnerId: s.id } });
      if (!existing) {
        await prisma.supplier.create({ data: { name: s.name, odooPartnerId: s.id, phone } });
        created++;
        if (phone) phonesFilled++;
      } else if (!existing.phone && phone) {
        await prisma.supplier.update({ where: { id: existing.id }, data: { phone } });
        phonesFilled++;
      }
    } catch {
      // Colisión por nombre duplicado: se conserva el existente.
    }
  }
  return { created, phonesFilled };
}
```

- [ ] **Step 3: Verificar con script temporal (lee Odoo, escribe solo en Supplier)**

Crea `scripts/tmp-verify-suppliers.ts`:

```ts
import { prisma } from "../src/lib/prisma";
import { ensureSuppliersFromHistory } from "../src/lib/suppliers";

async function main() {
  const created = await ensureSuppliersFromHistory();
  const total = await prisma.supplier.count();
  const sample = await prisma.supplier.findMany({ take: 3, select: { odooPartnerId: true } });
  console.log(`creados ahora: ${created} · total en directorio: ${total}`);
  console.log("todos con odooPartnerId? →", sample.every((s) => s.odooPartnerId !== null));
  const again = await ensureSuppliersFromHistory();
  console.log("idempotente (segunda corrida crea 0)? →", again === 0);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
```

Run: `npx tsx --env-file=.env.local scripts/tmp-verify-suppliers.ts`
Expected: `total en directorio` > 0, `todos con odooPartnerId? → true`, `idempotente… → true`

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 4: Borrar script temporal y commit**

```bash
rm scripts/tmp-verify-suppliers.ts
git add src/lib/suppliers.ts src/lib/odoo.ts
git commit -m "feat(reabastecimiento): directorio de proveedores desde historial y Odoo"
```

---

## Task 4: Motor de sugerencias — `src/lib/analytics/replenishment.ts`

**Files:**
- Create: `src/lib/analytics/replenishment.ts`

**Interfaces:**
- Consumes: `getABCAnalysis()` de `@/lib/analytics/abc`; `getOpenToBuyPlan()` de `@/lib/analytics/open-to-buy`; `isServiceCategory` de `@/lib/service-categories`; modelos de Task 1.
- Produces (los usan Tasks 6–8):

```ts
export type SuggestReason = "critico" | "advertencia" | "min_stock";
export interface CandidateProduct { odooProductId: number; name: string; category: string | null; stockQty: number; daysOfStock: number; avgDailySales7d: number; cmp: number; minStock: number; }
export function computeSuggestedQty(p: CandidateProduct, coverageDays: number): { qty: number; reason: SuggestReason } | null;
export interface SupplierRef { id: string; name: string; phone: string | null; odooPartnerId: number | null; }
export interface SuggestionLine { odooProductId: number; name: string; category: string | null; stockQty: number; daysOfStock: number; avgDailySales7d: number; suggestedQty: number; unitCost: number; tier: "A" | "B" | "C"; reason: SuggestReason; }
export interface ReplenishmentSuggestion { supplier: SupplierRef | null; lines: SuggestionLine[]; totalEstimated: number; }
export interface PendingLine { odooProductId: number; productName: string; qty: number; }
export interface PendingOrder { id: string; status: "APPROVED" | "SENT"; supplierId: string; supplierName: string; supplierPhone: string | null; odooOrderId: number | null; odooOrderName: string | null; totalEstimated: number; lines: PendingLine[]; sentAt: Date | null; createdAt: Date; daysWaiting: number; delayed: boolean; }
export interface ReplenishmentPlan { coverageDaysTarget: number; suggestions: ReplenishmentSuggestion[]; unassigned: ReplenishmentSuggestion; totals: { lineCount: number; criticalCount: number; warningCount: number; estimated: number; reinvestmentFund: number; gap: number }; pending: PendingOrder[]; }
export function getReplenishmentPlan(coverageDaysTarget?: number): Promise<ReplenishmentPlan>;
```

- [ ] **Step 1: Crear el módulo completo**

```ts
import { prisma } from "@/lib/prisma";
import { getABCAnalysis } from "@/lib/analytics/abc";
import { getOpenToBuyPlan } from "@/lib/analytics/open-to-buy";
import { isServiceCategory } from "@/lib/service-categories";

export type SuggestReason = "critico" | "advertencia" | "min_stock";

export interface CandidateProduct {
  odooProductId: number;
  name: string;
  category: string | null;
  stockQty: number;
  daysOfStock: number;
  avgDailySales7d: number;
  cmp: number;
  minStock: number;
}

/**
 * Cantidad sugerida = llevar el stock a `velocidad × cobertura objetivo`,
 * con piso en minStock. Pura para poder verificarla sin BD.
 * Devuelve null si no hay nada que pedir.
 */
export function computeSuggestedQty(
  p: CandidateProduct,
  coverageDays: number
): { qty: number; reason: SuggestReason } | null {
  const toCoverage = p.avgDailySales7d * coverageDays - p.stockQty;
  const toMinStock = p.minStock - p.stockQty;
  const raw = Math.max(toCoverage, toMinStock);
  if (raw <= 0) return null;
  const reason: SuggestReason =
    p.daysOfStock < 7 ? "critico" : p.daysOfStock < 14 ? "advertencia" : "min_stock";
  return { qty: Math.ceil(raw), reason };
}

export interface SupplierRef {
  id: string;
  name: string;
  phone: string | null;
  odooPartnerId: number | null;
}

export interface SuggestionLine {
  odooProductId: number;
  name: string;
  category: string | null;
  stockQty: number;
  daysOfStock: number;
  avgDailySales7d: number;
  suggestedQty: number;
  unitCost: number; // cmp
  tier: "A" | "B" | "C";
  reason: SuggestReason;
}

export interface ReplenishmentSuggestion {
  supplier: SupplierRef | null; // null = grupo "sin proveedor"
  lines: SuggestionLine[];
  totalEstimated: number; // solo líneas A/B (las C no se preseleccionan)
}

export interface PendingLine {
  odooProductId: number;
  productName: string;
  qty: number;
}

export interface PendingOrder {
  id: string;
  status: "APPROVED" | "SENT";
  supplierId: string;
  supplierName: string;
  supplierPhone: string | null;
  odooOrderId: number | null;
  odooOrderName: string | null;
  totalEstimated: number;
  lines: PendingLine[];
  sentAt: Date | null;
  createdAt: Date;
  daysWaiting: number; // desde sentAt (o createdAt si aún no se envía)
  delayed: boolean; // > 7 días enviados sin recibir
}

export interface ReplenishmentPlan {
  coverageDaysTarget: number;
  suggestions: ReplenishmentSuggestion[]; // una por proveedor, orden total desc
  unassigned: ReplenishmentSuggestion;
  totals: {
    lineCount: number; // líneas A/B sugeridas
    criticalCount: number;
    warningCount: number;
    estimated: number; // costo de las líneas A/B
    reinvestmentFund: number;
    gap: number; // estimated - fund (positivo = falta caja)
  };
  pending: PendingOrder[];
}

const DELAY_ALERT_DAYS = 7;

export async function getReplenishmentPlan(coverageDaysTarget = 21): Promise<ReplenishmentPlan> {
  // 1. Candidatos: venden, stock sano, sin regla de no-recompra (>45 días sin venta),
  //    y con hueco de cobertura o por debajo del mínimo.
  const candidates = await prisma.$queryRaw<CandidateProduct[]>`
    SELECT "odooProductId", "name", "category", "stockQty", "daysOfStock",
           "avgDailySales7d", "cmp", "minStock"
    FROM "ProductInsight"
    WHERE "avgDailySales7d" > 0
      AND "stockQty" >= 0
      AND "rotationDays" <= 45
      AND ("daysOfStock" < 14 OR "stockQty" < "minStock")
      AND "name" NOT LIKE '%(archivado)' -- marcador que deja el sync en stubs archivados: no se recompran
    ORDER BY "daysOfStock" ASC
  `;

  // 2. Excluir servicios y productos ya pedidos (pedido abierto en curso).
  const openLines = await prisma.replenishmentLine.findMany({
    where: { order: { status: { in: ["APPROVED", "SENT"] } } },
    select: { odooProductId: true },
  });
  const inFlight = new Set(openLines.map((l) => l.odooProductId));
  const filtered = candidates.filter(
    (c) => !isServiceCategory(c.category) && !inFlight.has(c.odooProductId)
  );

  // 3. Proveedor por producto: override manual > última compra en el historial.
  const overrides = await prisma.productSupplierOverride.findMany({ select: { odooProductId: true, supplierId: true } });
  const overrideByProduct = new Map(overrides.map((o) => [o.odooProductId, o.supplierId]));

  const history = await prisma.$queryRaw<Array<{ odooProductId: number; odooPartnerId: number | null }>>`
    SELECT DISTINCT ON (l."odooProductId") l."odooProductId", p."odooPartnerId"
    FROM "PurchaseOrderLine" l
    JOIN "PurchaseOrder" p ON p.id = l."purchaseOrderId"
    ORDER BY l."odooProductId", p."dateOrder" DESC
  `;
  const partnerByProduct = new Map(
    history.filter((h) => h.odooPartnerId !== null).map((h) => [h.odooProductId, h.odooPartnerId as number])
  );

  const suppliers = await prisma.supplier.findMany({ where: { active: true } });
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const supplierByPartner = new Map(
    suppliers.filter((s) => s.odooPartnerId !== null).map((s) => [s.odooPartnerId as number, s])
  );

  // 4. Tier ABC por producto (los que no aparecen en el análisis caen en C).
  const abc = await getABCAnalysis();
  const tierByProduct = new Map(abc.products.map((p) => [p.odooProductId, p.tier]));

  // 5. Armar líneas y agrupar por proveedor.
  const bySupplier = new Map<string, ReplenishmentSuggestion>();
  const unassigned: ReplenishmentSuggestion = { supplier: null, lines: [], totalEstimated: 0 };
  let criticalCount = 0;
  let warningCount = 0;

  for (const c of filtered) {
    const suggestion = computeSuggestedQty(c, coverageDaysTarget);
    if (!suggestion) continue;

    const line: SuggestionLine = {
      odooProductId: c.odooProductId,
      name: c.name,
      category: c.category,
      stockQty: c.stockQty,
      daysOfStock: c.daysOfStock,
      avgDailySales7d: c.avgDailySales7d,
      suggestedQty: suggestion.qty,
      unitCost: c.cmp,
      tier: tierByProduct.get(c.odooProductId) ?? "C",
      reason: suggestion.reason,
    };
    if (line.reason === "critico") criticalCount++;
    if (line.reason === "advertencia") warningCount++;

    const overrideSupplierId = overrideByProduct.get(c.odooProductId);
    const supplier = overrideSupplierId
      ? supplierById.get(overrideSupplierId)
      : (() => {
          const pid = partnerByProduct.get(c.odooProductId);
          return pid !== undefined ? supplierByPartner.get(pid) : undefined;
        })();

    if (!supplier) {
      unassigned.lines.push(line);
      continue;
    }
    let group = bySupplier.get(supplier.id);
    if (!group) {
      group = {
        supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone, odooPartnerId: supplier.odooPartnerId },
        lines: [],
        totalEstimated: 0,
      };
      bySupplier.set(supplier.id, group);
    }
    group.lines.push(line);
  }

  const abTotal = (lines: SuggestionLine[]) =>
    lines.filter((l) => l.tier !== "C").reduce((s, l) => s + l.suggestedQty * l.unitCost, 0);
  for (const g of bySupplier.values()) g.totalEstimated = abTotal(g.lines);
  unassigned.totalEstimated = abTotal(unassigned.lines);

  const suggestions = Array.from(bySupplier.values()).sort((a, b) => b.totalEstimated - a.totalEstimated);

  // 6. Disciplina OTB: comparar contra el Fondo de Reposición.
  const otb = await getOpenToBuyPlan(coverageDaysTarget).catch(() => null);
  const reinvestmentFund = otb?.reinvestmentFund ?? 0;
  const estimated = suggestions.reduce((s, g) => s + g.totalEstimated, 0) + unassigned.totalEstimated;
  const lineCount =
    suggestions.reduce((s, g) => s + g.lines.filter((l) => l.tier !== "C").length, 0) +
    unassigned.lines.filter((l) => l.tier !== "C").length;

  // 7. Pedidos en curso.
  const openOrders = await prisma.replenishmentOrder.findMany({
    where: { status: { in: ["APPROVED", "SENT"] } },
    include: { supplier: true, lines: true },
    orderBy: { createdAt: "asc" },
  });
  const nowMs = Date.now();
  const pending: PendingOrder[] = openOrders.map((o) => {
    const since = o.sentAt ?? o.createdAt;
    const daysWaiting = Math.floor((nowMs - since.getTime()) / 86_400_000);
    return {
      id: o.id,
      status: o.status as "APPROVED" | "SENT",
      supplierId: o.supplierId,
      supplierName: o.supplier.name,
      supplierPhone: o.supplier.phone,
      odooOrderId: o.odooOrderId,
      odooOrderName: o.odooOrderName,
      totalEstimated: o.totalEstimated,
      lines: o.lines.map((l) => ({ odooProductId: l.odooProductId, productName: l.productName, qty: l.qty })),
      sentAt: o.sentAt,
      createdAt: o.createdAt,
      daysWaiting,
      delayed: o.status === "SENT" && daysWaiting > DELAY_ALERT_DAYS,
    };
  });

  return {
    coverageDaysTarget,
    suggestions,
    unassigned,
    totals: { lineCount, criticalCount, warningCount, estimated, reinvestmentFund, gap: estimated - reinvestmentFund },
    pending,
  };
}
```

- [ ] **Step 2: Verificar la función pura con casos fijos**

Crea `scripts/tmp-verify-engine.ts` (no toca la BD):

```ts
import { computeSuggestedQty, type CandidateProduct } from "../src/lib/analytics/replenishment";

const base: CandidateProduct = {
  odooProductId: 1, name: "Producto Demo", category: "Demo",
  stockQty: 0, daysOfStock: 0, avgDailySales7d: 0, cmp: 1000, minStock: 5,
};

const cases: Array<{ desc: string; p: CandidateProduct; cov: number; expect: { qty: number; reason: string } | null }> = [
  { desc: "critico: vende 2/dia, stock 10, cobertura 21 → 32", p: { ...base, avgDailySales7d: 2, stockQty: 10, daysOfStock: 5 }, cov: 21, expect: { qty: 32, reason: "critico" } },
  { desc: "advertencia: vende 1/dia, stock 10, cobertura 21 → 11", p: { ...base, avgDailySales7d: 1, stockQty: 10, daysOfStock: 10 }, cov: 21, expect: { qty: 11, reason: "advertencia" } },
  { desc: "min_stock: vende 0.05/dia, stock 3, minStock 5 → 2", p: { ...base, avgDailySales7d: 0.05, stockQty: 3, daysOfStock: 60 }, cov: 21, expect: { qty: 2, reason: "min_stock" } },
  { desc: "redondeo hacia arriba: 0.4 faltante → 1", p: { ...base, avgDailySales7d: 0.4, stockQty: 8, daysOfStock: 20, minStock: 0 }, cov: 21, expect: { qty: 1, reason: "min_stock" } },
  { desc: "sin faltante → null", p: { ...base, avgDailySales7d: 1, stockQty: 40, daysOfStock: 40 }, cov: 21, expect: null },
];

let failures = 0;
for (const c of cases) {
  const got = computeSuggestedQty(c.p, c.cov);
  const ok = c.expect === null ? got === null : got !== null && got.qty === c.expect.qty && got.reason === c.expect.reason;
  if (!ok) failures++;
  console.log(`${ok ? "OK " : "FAIL"} ${c.desc} → ${JSON.stringify(got)}`);
}
process.exit(failures === 0 ? 0 : 1);
```

Run: `npx tsx scripts/tmp-verify-engine.ts`
Expected: 5 líneas `OK`, exit 0

- [ ] **Step 3: Verificar el plan completo contra la BD (solo lectura)**

Crea `scripts/tmp-verify-plan.ts`:

```ts
import { getReplenishmentPlan } from "../src/lib/analytics/replenishment";

async function main() {
  const plan = await getReplenishmentPlan(21);
  console.log(`proveedores con sugerencia: ${plan.suggestions.length}`);
  console.log(`lineas A/B: ${plan.totals.lineCount} · criticos: ${plan.totals.criticalCount} · advertencia: ${plan.totals.warningCount}`);
  console.log(`sin proveedor: ${plan.unassigned.lines.length}`);
  console.log(`estimado vs fondo: ${Math.round(plan.totals.estimated)} / ${Math.round(plan.totals.reinvestmentFund)}`);
  console.log(`pedidos en curso: ${plan.pending.length}`);
  const allPositive = plan.suggestions.every((s) => s.lines.every((l) => l.suggestedQty > 0));
  console.log("todas las cantidades > 0? →", allPositive);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
```

Run: `npx tsx --env-file=.env.local scripts/tmp-verify-plan.ts`
Expected: números coherentes con Inventario (decenas de críticos, no miles), `todas las cantidades > 0? → true`

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 4: Borrar scripts temporales y commit**

```bash
rm scripts/tmp-verify-engine.ts scripts/tmp-verify-plan.ts
git add src/lib/analytics/replenishment.ts
git commit -m "feat(reabastecimiento): motor de sugerencias por producto y proveedor"
```

---

## Task 5: Helper de WhatsApp — `src/lib/whatsapp.ts`

**Files:**
- Create: `src/lib/whatsapp.ts`

**Interfaces:**
- Produces (los usa Task 7):

```ts
export function normalizePhoneForWhatsApp(raw: string): string | null; // dígitos con indicativo 57, o null si no sirve
export function buildOrderMessage(supplierName: string, lines: Array<{ qty: number; name: string }>): string;
export function buildWaLink(phone: string, message: string): string | null; // https://wa.me/<digits>?text=...
```

- [ ] **Step 1: Crear el módulo**

```ts
/**
 * Utilidades puras para armar el mensaje de pedido por WhatsApp (enlace wa.me).
 * Sin llamadas de red: el envío lo hace el usuario desde su propio WhatsApp.
 */

/** Normaliza a formato wa.me (solo dígitos, con indicativo). Colombia por defecto. */
export function normalizePhoneForWhatsApp(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return `57${digits}`; // celular CO sin indicativo
  if (digits.length === 12 && digits.startsWith("57")) return digits; // ya trae indicativo
  if (digits.length >= 11 && digits.length <= 15) return digits; // otro país, se respeta
  return null;
}

export function buildOrderMessage(
  supplierName: string,
  lines: Array<{ qty: number; name: string }>
): string {
  const items = lines.map((l) => `• ${l.qty} × ${l.name}`).join("\n");
  return (
    `Hola ${supplierName}, ¿cómo estás? Te paso el pedido:\n\n` +
    `${items}\n\n` +
    `¿Me confirmas disponibilidad y fecha de entrega? ¡Gracias!`
  );
}

export function buildWaLink(phone: string, message: string): string | null {
  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
```

- [ ] **Step 2: Verificar con casos fijos**

Crea `scripts/tmp-verify-wa.ts`:

```ts
import { normalizePhoneForWhatsApp, buildOrderMessage, buildWaLink } from "../src/lib/whatsapp";

const checks: Array<[string, boolean]> = [
  ["celular CO 10 dígitos", normalizePhoneForWhatsApp("300 123 4567") === "573001234567"],
  ["ya con indicativo", normalizePhoneForWhatsApp("+57 300 123 4567") === "573001234567"],
  ["basura → null", normalizePhoneForWhatsApp("abc") === null],
  ["fijo corto → null", normalizePhoneForWhatsApp("1234567") === null],
  ["mensaje contiene línea", buildOrderMessage("Proveedor Demo", [{ qty: 3, name: "Cuaderno Demo" }]).includes("• 3 × Cuaderno Demo")],
  ["link wa.me bien formado", (buildWaLink("3001234567", "hola mundo") ?? "").startsWith("https://wa.me/573001234567?text=hola%20mundo")],
  ["link con teléfono inválido → null", buildWaLink("abc", "x") === null],
];

let failures = 0;
for (const [desc, ok] of checks) {
  if (!ok) failures++;
  console.log(`${ok ? "OK " : "FAIL"} ${desc}`);
}
process.exit(failures === 0 ? 0 : 1);
```

Run: `npx tsx scripts/tmp-verify-wa.ts`
Expected: 7 líneas `OK`, exit 0

- [ ] **Step 3: Borrar script temporal y commit**

```bash
rm scripts/tmp-verify-wa.ts
git add src/lib/whatsapp.ts
git commit -m "feat(reabastecimiento): helper de mensaje y enlace de WhatsApp"
```

---

## Task 6: Server actions — `src/app/(dashboard)/reabastecimiento/actions.ts`

**Files:**
- Create: `src/app/(dashboard)/reabastecimiento/actions.ts`

**Interfaces:**
- Consumes: modelos de Task 1; patrón `requireSession` (igual a `src/app/(dashboard)/campanas/actions.ts`): `auth` de `@/lib/auth`.
- Produces (los usan Tasks 7–8; en esta task `approveOrder` NO llama a Odoo todavía — eso lo agrega Task 8):

```ts
// ActionResult = { ok: boolean; error?: string } — tipo interno del archivo, no exportado
export async function approveOrder(input: unknown): Promise<ActionResult & { orderId?: string; odooOrderName?: string | null; odooError?: string }>;
export async function markSent(orderId: string): Promise<ActionResult>;
export async function cancelOrder(orderId: string): Promise<ActionResult & { odooOrderName?: string | null }>;
export async function assignSupplier(odooProductId: number, supplierId: string): Promise<ActionResult>;
export async function saveSupplier(input: unknown): Promise<ActionResult & { supplierId?: string }>;
```

- [ ] **Step 1: Crear el módulo**

```ts
"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// Un archivo "use server" solo puede exportar funciones async; el tipo queda interno.
type ActionResult = { ok: boolean; error?: string };

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("No autorizado");
  return session;
}

const approveSchema = z.object({
  supplierId: z.string().min(1),
  lines: z
    .array(
      z.object({
        odooProductId: z.number().int().positive(),
        productName: z.string().min(1).max(300),
        qty: z.number().positive().max(100_000),
        suggestedQty: z.number().nonnegative(),
        unitCost: z.number().nonnegative(),
        reason: z.enum(["critico", "advertencia", "min_stock"]),
      })
    )
    .min(1)
    .max(200),
});

/**
 * Aprueba un pedido: persiste ReplenishmentOrder + líneas. La creación del
 * borrador en Odoo se integra en una fase posterior (ver plan, Task 8).
 */
export async function approveOrder(
  input: unknown
): Promise<ActionResult & { orderId?: string; odooOrderName?: string | null; odooError?: string }> {
  await requireSession();
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }
  const { supplierId, lines } = parsed.data;

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return { ok: false, error: "Proveedor no encontrado" };

  const totalEstimated = lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
  try {
    const order = await prisma.replenishmentOrder.create({
      data: {
        supplierId,
        totalEstimated,
        lines: { createMany: { data: lines } },
      },
    });
    revalidatePath("/reabastecimiento");
    return { ok: true, orderId: order.id, odooOrderName: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Marca el pedido como enviado al proveedor (clic en WhatsApp o manual). */
export async function markSent(orderId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await prisma.replenishmentOrder.updateMany({
      where: { id: orderId, status: "APPROVED" },
      data: { status: "SENT", sentAt: new Date() },
    });
    revalidatePath("/reabastecimiento");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Cancela un pedido abierto. Si ya existe borrador en Odoo, se cancela allá (se informa el nombre). */
export async function cancelOrder(orderId: string): Promise<ActionResult & { odooOrderName?: string | null }> {
  await requireSession();
  try {
    const order = await prisma.replenishmentOrder.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, error: "Pedido no encontrado" };
    if (order.status !== "APPROVED" && order.status !== "SENT") {
      return { ok: false, error: "El pedido ya no está abierto" };
    }
    await prisma.replenishmentOrder.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
    revalidatePath("/reabastecimiento");
    return { ok: true, odooOrderName: order.odooOrderName };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Asigna (o cambia) el proveedor de un producto sin historial. Persistente. */
export async function assignSupplier(odooProductId: number, supplierId: string): Promise<ActionResult> {
  await requireSession();
  const parsed = z.object({ odooProductId: z.number().int().positive(), supplierId: z.string().min(1) }).safeParse({ odooProductId, supplierId });
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };
  try {
    await prisma.productSupplierOverride.upsert({
      where: { odooProductId },
      create: { odooProductId, supplierId },
      update: { supplierId },
    });
    revalidatePath("/reabastecimiento");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const supplierSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "El nombre es obligatorio").max(150),
  phone: z.string().max(30).optional(),
});

/** Crea o edita un proveedor del directorio (nombre y WhatsApp). */
export async function saveSupplier(input: unknown): Promise<ActionResult & { supplierId?: string }> {
  await requireSession();
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }
  const { id, name, phone } = parsed.data;
  try {
    const supplier = id
      ? await prisma.supplier.update({ where: { id }, data: { name, phone: phone || null } })
      : await prisma.supplier.create({ data: { name, phone: phone || null } });
    revalidatePath("/reabastecimiento");
    return { ok: true, supplierId: supplier.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/reabastecimiento/actions.ts"
git commit -m "feat(reabastecimiento): server actions de aprobacion y directorio"
```

---

## Task 7: Página `/reabastecimiento` + tablero + pedidos en curso (cierra F1)

**Files:**
- Create: `src/app/(dashboard)/reabastecimiento/page.tsx`
- Create: `src/components/dashboard/ReplenishmentBoard.tsx`
- Create: `src/components/dashboard/ReplenishmentPending.tsx`

**Interfaces:**
- Consumes: `getReplenishmentPlan`, tipos de Task 4; actions de Task 6; helpers de Task 5; `ensureSuppliersFromHistory` de Task 3; `formatCurrency`, `cn` de `@/lib/utils`.
- Produces: página funcional (F1 completa): sugerencias editables, aprobar (sin Odoo aún), asignar proveedor, WhatsApp desde "Pedidos en curso".

- [ ] **Step 1: Crear la página (RSC)**

`src/app/(dashboard)/reabastecimiento/page.tsx`:

```tsx
export const dynamic = "force-dynamic";

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getReplenishmentPlan } from "@/lib/analytics/replenishment";
import { ensureSuppliersFromHistory } from "@/lib/suppliers";
import { ReplenishmentBoard } from "@/components/dashboard/ReplenishmentBoard";
import { ReplenishmentPending } from "@/components/dashboard/ReplenishmentPending";
import { formatCurrency, cn } from "@/lib/utils";
import { ClipboardList, AlertTriangle, XCircle, Wallet } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ coverage?: string }>;
}

export default async function ReabastecimientoPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const coverage = Math.max(7, Math.min(90, Number(params.coverage) || 21));

  // El directorio se completa solo desde el historial (idempotente, volumen bajo).
  await ensureSuppliersFromHistory().catch(() => {});

  const plan = await getReplenishmentPlan(coverage).catch(() => null);
  const suppliers = await prisma.supplier.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true, odooPartnerId: true },
  });

  if (!plan) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Reabastecimiento</h1>
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Aún no hay datos para sugerir pedidos</p>
        </div>
      </div>
    );
  }

  const { totals } = plan;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Reabastecimiento</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pedido sugerido por proveedor — revisa, ajusta y aprueba; nada se envía solo
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Cobertura objetivo:</span>
          {[14, 21, 30, 45].map((d) => (
            <Link
              key={d}
              href={`/reabastecimiento?coverage=${d}`}
              className={cn(
                "rounded-lg border px-3 py-1.5 font-medium transition-colors",
                d === plan.coverageDaysTarget
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card hover:bg-secondary"
              )}
            >
              {d}d
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-center">
          <XCircle className="h-5 w-5 text-destructive mx-auto mb-1" />
          <p className="text-2xl font-bold text-destructive">{totals.criticalCount}</p>
          <p className="text-xs text-muted-foreground">críticos (&lt;7 días)</p>
        </div>
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-center">
          <AlertTriangle className="h-5 w-5 text-warning mx-auto mb-1" />
          <p className="text-2xl font-bold text-warning">{totals.warningCount}</p>
          <p className="text-xs text-muted-foreground">advertencia (7–14 días)</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <ClipboardList className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-2xl font-bold">{formatCurrency(totals.estimated)}</p>
          <p className="text-xs text-muted-foreground">pedido sugerido (clase A/B)</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <Wallet className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className={cn("text-2xl font-bold", totals.gap > 0 ? "text-destructive" : "text-primary")}>
            {totals.gap > 0 ? `−${formatCurrency(totals.gap)}` : formatCurrency(totals.reinvestmentFund)}
          </p>
          <p className="text-xs text-muted-foreground">
            {totals.gap > 0 ? "faltante vs Fondo de Reposición" : "Fondo de Reposición disponible"}
          </p>
        </div>
      </div>

      <ReplenishmentPending pending={plan.pending} />

      <ReplenishmentBoard
        suggestions={plan.suggestions}
        unassigned={plan.unassigned}
        suppliers={suppliers}
      />
    </div>
  );
}
```

- [ ] **Step 2: Crear el tablero (client)**

`src/components/dashboard/ReplenishmentBoard.tsx`:

```tsx
"use client";

import { useMemo, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  approveOrder,
  assignSupplier,
  saveSupplier,
} from "@/app/(dashboard)/reabastecimiento/actions";
import type {
  ReplenishmentSuggestion,
  SuggestionLine,
} from "@/lib/analytics/replenishment";
import { formatCurrency, cn } from "@/lib/utils";
import { Check, ChevronDown, ChevronRight, Store, Trash2, UserPlus } from "lucide-react";

interface SupplierOption {
  id: string;
  name: string;
  phone: string | null;
  odooPartnerId: number | null;
}

interface Props {
  suggestions: ReplenishmentSuggestion[];
  unassigned: ReplenishmentSuggestion;
  suppliers: SupplierOption[];
}

const reasonBadge: Record<SuggestionLine["reason"], { label: string; cls: string }> = {
  critico: { label: "crítico", cls: "bg-destructive/10 text-destructive" },
  advertencia: { label: "advertencia", cls: "bg-warning/10 text-warning" },
  min_stock: { label: "mín. stock", cls: "bg-secondary text-muted-foreground" },
};

export function ReplenishmentBoard({ suggestions, unassigned, suppliers }: Props) {
  return (
    <div className="space-y-4">
      {suggestions.length === 0 && unassigned.lines.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Sin pedidos sugeridos — vas bien de stock
        </div>
      )}
      {suggestions.map((s) => (
        <SupplierCard key={s.supplier!.id} suggestion={s} />
      ))}
      {unassigned.lines.length > 0 && <UnassignedCard unassigned={unassigned} suppliers={suppliers} />}
    </div>
  );
}

function SupplierCard({ suggestion }: { suggestion: ReplenishmentSuggestion }) {
  const supplier = suggestion.supplier!;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);
  const [showC, setShowC] = useState(false);
  // qty editable por producto; las C arrancan en 0 (no preseleccionadas)
  const [qty, setQty] = useState<Record<number, number>>(() =>
    Object.fromEntries(suggestion.lines.map((l) => [l.odooProductId, l.tier === "C" ? 0 : l.suggestedQty]))
  );

  const abLines = suggestion.lines.filter((l) => l.tier !== "C");
  const cLines = suggestion.lines.filter((l) => l.tier === "C");
  const activeLines = suggestion.lines.filter((l) => (qty[l.odooProductId] ?? 0) > 0);
  const total = useMemo(
    () => activeLines.reduce((s, l) => s + (qty[l.odooProductId] ?? 0) * l.unitCost, 0),
    [activeLines, qty]
  );

  if (dismissed) return null;

  const approve = () => {
    if (activeLines.length === 0) {
      toast.error("El pedido no tiene cantidades");
      return;
    }
    startTransition(async () => {
      const res = await approveOrder({
        supplierId: supplier.id,
        lines: activeLines.map((l) => ({
          odooProductId: l.odooProductId,
          productName: l.name,
          qty: qty[l.odooProductId] ?? 0,
          suggestedQty: l.suggestedQty,
          unitCost: l.unitCost,
          reason: l.reason,
        })),
      });
      if (!res.ok) {
        toast.error(res.error ?? "No se pudo aprobar el pedido");
        return;
      }
      if (res.odooError) {
        toast.warning(`Pedido aprobado, pero Odoo falló: ${res.odooError}. Reintenta desde "Pedidos en curso".`);
      } else if (res.odooOrderName) {
        toast.success(`Pedido aprobado — borrador ${res.odooOrderName} creado en Odoo`);
      } else {
        toast.success("Pedido aprobado");
      }
      router.refresh();
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-primary" />
          <p className="font-semibold">{supplier.name}</p>
          <span className="text-xs text-muted-foreground">
            {activeLines.length} producto{activeLines.length === 1 ? "" : "s"} · {formatCurrency(total)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={approve}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {isPending ? "Aprobando…" : "Aprobar pedido"}
          </button>
          <button
            onClick={() => setDismissed(true)}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Descartar
          </button>
        </div>
      </div>

      <LineTable lines={abLines} qty={qty} setQty={setQty} />

      {cLines.length > 0 && (
        <div className="border-t border-border">
          <button
            onClick={() => setShowC((v) => !v)}
            className="flex w-full items-center gap-1.5 p-3 text-xs text-muted-foreground hover:bg-secondary/50"
          >
            {showC ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Clase C — evalúa si vale la pena ({cLines.length})
          </button>
          {showC && <LineTable lines={cLines} qty={qty} setQty={setQty} />}
        </div>
      )}
    </div>
  );
}

function LineTable({
  lines,
  qty,
  setQty,
}: {
  lines: SuggestionLine[];
  qty: Record<number, number>;
  setQty: Dispatch<SetStateAction<Record<number, number>>>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Producto</th>
            <th className="px-2 py-2 font-medium text-right">Stock</th>
            <th className="px-2 py-2 font-medium text-right">Cobertura</th>
            <th className="px-2 py-2 font-medium text-right">Vende/día</th>
            <th className="px-2 py-2 font-medium text-center">Motivo</th>
            <th className="px-2 py-2 font-medium text-right">Pedir</th>
            <th className="px-4 py-2 font-medium text-right">Costo est.</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const q = qty[l.odooProductId] ?? 0;
            const badge = reasonBadge[l.reason];
            return (
              <tr key={l.odooProductId} className="border-t border-border/60">
                <td className="px-4 py-2">
                  <span className="line-clamp-1">{l.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {l.tier} · {l.category ?? "sin categoría"}
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{Math.round(l.stockQty)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{l.daysOfStock.toFixed(0)}d</td>
                <td className="px-2 py-2 text-right tabular-nums">{l.avgDailySales7d.toFixed(1)}</td>
                <td className="px-2 py-2 text-center">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", badge.cls)}>{badge.label}</span>
                </td>
                <td className="px-2 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    value={q}
                    onChange={(e) =>
                      setQty((prev) => ({ ...prev, [l.odooProductId]: Math.max(0, Number(e.target.value) || 0) }))
                    }
                    className="w-16 rounded-md border border-border bg-background px-2 py-1 text-right text-sm"
                  />
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(q * l.unitCost)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UnassignedCard({
  unassigned,
  suppliers,
}: {
  unassigned: ReplenishmentSuggestion;
  suppliers: SupplierOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");

  const assign = (odooProductId: number, supplierId: string) => {
    if (!supplierId) return;
    startTransition(async () => {
      const res = await assignSupplier(odooProductId, supplierId);
      if (!res.ok) toast.error(res.error ?? "No se pudo asignar");
      else router.refresh();
    });
  };

  const createSupplier = () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      const res = await saveSupplier({ name: newName.trim() });
      if (!res.ok) toast.error(res.error ?? "No se pudo crear el proveedor");
      else {
        toast.success("Proveedor creado — asígnalo a los productos");
        setNewName("");
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-xl border border-dashed border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4 flex-wrap">
        <p className="font-semibold text-muted-foreground">
          Sin proveedor ({unassigned.lines.length}) — asigna una vez y el sistema lo recuerda
        </p>
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nuevo proveedor…"
            className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          />
          <button
            onClick={createSupplier}
            disabled={isPending || !newName.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Crear
          </button>
        </div>
      </div>
      <div className="divide-y divide-border/60">
        {unassigned.lines.map((l) => (
          <div key={l.odooProductId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm flex-wrap">
            <div>
              <span className="line-clamp-1">{l.name}</span>
              <span className="text-[10px] text-muted-foreground">
                stock {Math.round(l.stockQty)} · {l.daysOfStock.toFixed(0)}d · sugerido {l.suggestedQty}
              </span>
            </div>
            <select
              defaultValue=""
              disabled={isPending}
              onChange={(e) => assign(l.odooProductId, e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="" disabled>
                Asignar proveedor…
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Crear pedidos en curso (client)**

`src/components/dashboard/ReplenishmentPending.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cancelOrder, markSent, saveSupplier } from "@/app/(dashboard)/reabastecimiento/actions";
import type { PendingOrder } from "@/lib/analytics/replenishment";
import { buildOrderMessage, buildWaLink } from "@/lib/whatsapp";
import { formatCurrency, cn } from "@/lib/utils";
import { AlertTriangle, MessageCircle, Truck, X } from "lucide-react";

export function ReplenishmentPending({ pending }: { pending: PendingOrder[] }) {
  if (pending.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Truck className="h-4 w-4 text-primary" />
        <p className="font-semibold">Pedidos en curso ({pending.length})</p>
      </div>
      <div className="divide-y divide-border/60">
        {pending.map((o) => (
          <PendingRow key={o.id} order={o} />
        ))}
      </div>
    </div>
  );
}

function PendingRow({ order }: { order: PendingOrder }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [phoneDraft, setPhoneDraft] = useState("");

  const waLink = order.supplierPhone
    ? buildWaLink(
        order.supplierPhone,
        buildOrderMessage(
          order.supplierName,
          order.lines.map((l) => ({ qty: l.qty, name: l.productName }))
        )
      )
    : null;

  const sendWhatsApp = () => {
    if (!waLink) return;
    window.open(waLink, "_blank", "noopener,noreferrer");
    if (order.status === "APPROVED") {
      startTransition(async () => {
        const res = await markSent(order.id);
        if (!res.ok) toast.error(res.error ?? "No se pudo marcar como enviado");
        else router.refresh();
      });
    }
  };

  const cancel = () => {
    startTransition(async () => {
      const res = await cancelOrder(order.id);
      if (!res.ok) {
        toast.error(res.error ?? "No se pudo cancelar");
        return;
      }
      if (res.odooOrderName) {
        toast.info(`Cancelado en Utilia. Recuerda cancelar el borrador ${res.odooOrderName} en Odoo.`);
      } else {
        toast.success("Pedido cancelado");
      }
      router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm flex-wrap">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium">{order.supplierName}</p>
          <span className="text-xs text-muted-foreground">
            {order.lines.length} ítem{order.lines.length === 1 ? "" : "s"} · {formatCurrency(order.totalEstimated)}
          </span>
          {order.odooOrderName && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
              Odoo {order.odooOrderName}
            </span>
          )}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              order.status === "SENT" ? "bg-primary/10 text-primary" : "bg-warning/10 text-warning"
            )}
          >
            {order.status === "SENT" ? `enviado hace ${order.daysWaiting}d` : "aprobado, sin enviar"}
          </span>
          {order.delayed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
              <AlertTriangle className="h-3 w-3" />
              demorado — ¿reclamar?
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {waLink ? (
          <button
            onClick={sendWhatsApp}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {order.status === "SENT" ? "Reenviar WhatsApp" : "Enviar WhatsApp"}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              placeholder="WhatsApp del proveedor…"
              className="w-40 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
            <button
              onClick={() =>
                startTransition(async () => {
                  const res = await saveSupplier({ id: order.supplierId, name: order.supplierName, phone: phoneDraft });
                  if (!res.ok) toast.error(res.error ?? "No se pudo guardar");
                  else router.refresh();
                })
              }
              disabled={isPending || !phoneDraft.trim()}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        )}
        <button
          onClick={cancel}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
        >
          <X className="h-3.5 w-3.5" />
          Cancelar
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verificar tipos y probar en el navegador**

Run: `npx tsc --noEmit`
Expected: sin errores

Run: `npm run dev` y abrir `http://localhost:3000/reabastecimiento`

Checklist manual:
1. KPIs muestran conteos coherentes con `/inventario`.
2. Cada tarjeta agrupa productos de un proveedor real del historial; cantidades editables; total cambia al editar.
3. Sección "Clase C" colapsada por defecto, con cantidades en 0.
4. "Aprobar pedido" → toast, la tarjeta desaparece (productos quedan en pedido abierto) y aparece fila en "Pedidos en curso".
5. En "Pedidos en curso": si el proveedor no tiene teléfono, aparece el campo para capturarlo; al guardarlo aparece el botón WhatsApp; el enlace abre `wa.me` con el mensaje correcto (verificar el texto).
6. "Enviar WhatsApp" marca el pedido como enviado (badge cambia).
7. "Cancelar" retira el pedido y los productos vuelven a sugerirse al recargar.
8. Grupo "Sin proveedor": asignar un proveedor mueve el producto a su tarjeta al recargar; crear proveedor nuevo funciona.
9. Selector de cobertura 14/21/30/45 recalcula cantidades.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/reabastecimiento/page.tsx" src/components/dashboard/ReplenishmentBoard.tsx src/components/dashboard/ReplenishmentPending.tsx
git commit -m "feat(reabastecimiento): pagina de pedidos sugeridos con WhatsApp"
```

---

## Task 8: Escritura a Odoo — `src/lib/odoo-write.ts` + integración (cierra F2)

**Files:**
- Create: `src/lib/odoo-write.ts`
- Modify: `src/lib/odoo.ts` (comentario de `odooRpc`, ~línea 519)
- Modify: `src/app/(dashboard)/reabastecimiento/actions.ts` (integrar en `approveOrder`; agregar `retryOdooDraft` e `importSuppliersAction`)
- Modify: `src/components/dashboard/ReplenishmentPending.tsx` (botón de reintento)
- Modify: `src/components/dashboard/ReplenishmentBoard.tsx` (botón "Importar proveedores de Odoo")

**Interfaces:**
- Consumes: `odooRpc` de `@/lib/odoo`; `importSuppliersFromOdoo` de Task 3.
- Produces:

```ts
// src/lib/odoo-write.ts
export async function createDraftPurchaseOrder(input: {
  odooPartnerId: number;
  originRef: string;
  lines: Array<{ odooProductId: number; qty: number; priceUnit: number }>;
}): Promise<{ odooOrderId: number; odooOrderName: string }>;
// actions.ts (nuevas)
export async function retryOdooDraft(orderId: string): Promise<ActionResult & { odooOrderName?: string }>;
export async function importSuppliersAction(): Promise<ActionResult & { created?: number; phonesFilled?: number }>;
```

- [ ] **Step 1: Crear `src/lib/odoo-write.ts`**

```ts
import { odooRpc } from "@/lib/odoo";

/**
 * ÚNICA escritura permitida hacia Odoo desde la app.
 *
 * Contrato:
 *  - Solo se invoca desde server actions disparadas por un clic del usuario
 *    (aprobar/reintentar pedido). Ningún sync, cron o route handler la importa.
 *  - Solo crea `purchase.order` en estado BORRADOR: no toca stock, gasto ni
 *    contabilidad. El borrador se confirma (o cancela) manualmente en Odoo.
 *  - El sync ignora borradores (filtra state purchase/done), así que no hay
 *    doble conteo de gasto.
 */
export async function createDraftPurchaseOrder(input: {
  odooPartnerId: number;
  originRef: string; // trazabilidad: "UTILIA-REP-<id>" en el campo origin
  lines: Array<{ odooProductId: number; qty: number; priceUnit: number }>;
}): Promise<{ odooOrderId: number; odooOrderName: string }> {
  const { odooPartnerId, originRef, lines } = input;
  if (lines.length === 0) throw new Error("El pedido no tiene líneas");

  const odooOrderId = await odooRpc.executeKw<number>("purchase.order", "create", [
    {
      partner_id: odooPartnerId,
      origin: originRef,
      order_line: lines.map((l) => [
        0,
        0,
        // price_unit = CMP como estimado honesto; el precio real se ajusta en
        // Odoo al confirmar si el proveedor cambió la lista.
        { product_id: l.odooProductId, product_qty: l.qty, price_unit: l.priceUnit },
      ]),
    },
  ]);

  const rows = await odooRpc.searchRead<{ id: number; name: string }>(
    "purchase.order",
    [["id", "=", odooOrderId]],
    ["id", "name"],
    { limit: 1 }
  );
  return { odooOrderId, odooOrderName: rows[0]?.name ?? `#${odooOrderId}` };
}
```

- [ ] **Step 2: Actualizar el comentario de `odooRpc` en `src/lib/odoo.ts`**

Reemplaza el bloque de comentario sobre `export const odooRpc` (el que dice "NO usar desde rutas de sync ni desde route handlers…") por:

```ts
/**
 * Acceso RPC crudo para los scripts administrativos de `scripts/` y para
 * `src/lib/odoo-write.ts` (creación de borradores de compra por acción del
 * usuario — ver el contrato en ese módulo).
 *
 * NO usar desde rutas de sync: Odoo es upstream y el sync nunca le escribe.
 */
```

- [ ] **Step 3: Integrar en `approveOrder` y agregar acciones nuevas**

En `src/app/(dashboard)/reabastecimiento/actions.ts`:

Agrega los imports:

```ts
import { createDraftPurchaseOrder } from "@/lib/odoo-write";
import { importSuppliersFromOdoo } from "@/lib/suppliers";
```

En `approveOrder`, reemplaza el bloque `try { … return { ok: true, orderId: order.id, odooOrderName: null }; }` por:

```ts
  try {
    const order = await prisma.replenishmentOrder.create({
      data: {
        supplierId,
        totalEstimated,
        lines: { createMany: { data: lines } },
      },
    });

    // Borrador en Odoo: solo si el proveedor está vinculado. Si el RPC falla,
    // el pedido queda aprobado en Utilia y se reintenta desde la UI.
    let odooOrderName: string | null = null;
    let odooError: string | undefined;
    if (supplier.odooPartnerId) {
      try {
        const draft = await createDraftPurchaseOrder({
          odooPartnerId: supplier.odooPartnerId,
          originRef: `UTILIA-REP-${order.id}`,
          lines: lines.map((l) => ({ odooProductId: l.odooProductId, qty: l.qty, priceUnit: l.unitCost })),
        });
        await prisma.replenishmentOrder.update({
          where: { id: order.id },
          data: { odooOrderId: draft.odooOrderId, odooOrderName: draft.odooOrderName },
        });
        odooOrderName = draft.odooOrderName;
      } catch (err) {
        odooError = err instanceof Error ? err.message : String(err);
      }
    } else {
      odooError = "El proveedor no está vinculado a Odoo";
    }

    revalidatePath("/reabastecimiento");
    return { ok: true, orderId: order.id, odooOrderName, odooError };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
```

Al final del archivo agrega:

```ts
/** Reintenta crear el borrador en Odoo para un pedido aprobado que quedó sin orden. */
export async function retryOdooDraft(orderId: string): Promise<ActionResult & { odooOrderName?: string }> {
  await requireSession();
  try {
    const order = await prisma.replenishmentOrder.findUnique({
      where: { id: orderId },
      include: { supplier: true, lines: true },
    });
    if (!order) return { ok: false, error: "Pedido no encontrado" };
    if (order.odooOrderId) return { ok: true, odooOrderName: order.odooOrderName ?? undefined }; // idempotente
    if (order.status !== "APPROVED" && order.status !== "SENT") {
      return { ok: false, error: "El pedido ya no está abierto" };
    }
    if (!order.supplier.odooPartnerId) {
      return { ok: false, error: "El proveedor no está vinculado a Odoo" };
    }
    const draft = await createDraftPurchaseOrder({
      odooPartnerId: order.supplier.odooPartnerId,
      originRef: `UTILIA-REP-${order.id}`,
      lines: order.lines.map((l) => ({ odooProductId: l.odooProductId, qty: l.qty, priceUnit: l.unitCost })),
    });
    await prisma.replenishmentOrder.update({
      where: { id: order.id },
      data: { odooOrderId: draft.odooOrderId, odooOrderName: draft.odooOrderName },
    });
    revalidatePath("/reabastecimiento");
    return { ok: true, odooOrderName: draft.odooOrderName };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Importa/actualiza el directorio de proveedores desde los contactos de Odoo. */
export async function importSuppliersAction(): Promise<ActionResult & { created?: number; phonesFilled?: number }> {
  await requireSession();
  try {
    const res = await importSuppliersFromOdoo();
    revalidatePath("/reabastecimiento");
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Botón de reintento en `ReplenishmentPending.tsx`**

Agrega `retryOdooDraft` al import de actions. En `PendingRow`, dentro del `div` de acciones (antes del botón Cancelar), agrega:

```tsx
        {!order.odooOrderId && (
          <button
            onClick={() =>
              startTransition(async () => {
                const res = await retryOdooDraft(order.id);
                if (!res.ok) toast.error(res.error ?? "Odoo falló de nuevo");
                else {
                  toast.success(`Borrador ${res.odooOrderName ?? ""} creado en Odoo`);
                  router.refresh();
                }
              })
            }
            disabled={isPending}
            className="rounded-lg border border-warning/50 px-2.5 py-1.5 text-xs text-warning hover:bg-warning/10 disabled:opacity-50"
          >
            Crear en Odoo
          </button>
        )}
```

- [ ] **Step 5: Botón "Importar proveedores de Odoo" en `ReplenishmentBoard.tsx`**

Agrega `importSuppliersAction` al import de actions. En `UnassignedCard`, junto al botón "Crear" (dentro del mismo `div` de acciones), agrega:

```tsx
          <button
            onClick={() =>
              startTransition(async () => {
                const res = await importSuppliersAction();
                if (!res.ok) toast.error(res.error ?? "No se pudo importar");
                else {
                  toast.success(`Proveedores: ${res.created ?? 0} nuevos, ${res.phonesFilled ?? 0} teléfonos completados`);
                  router.refresh();
                }
              })
            }
            disabled={isPending}
            className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
          >
            Importar de Odoo
          </button>
```

- [ ] **Step 6: Verificación manual del borrador (prueba controlada e inofensiva)**

Run: `npx tsc --noEmit` → sin errores.

Con `npm run dev`:
1. Aprobar un pedido pequeño (1–2 productos) de un proveedor vinculado.
2. Toast debe nombrar el borrador (ej "borrador P00xxx creado en Odoo").
3. En Odoo → Compras: verificar la orden en estado **Solicitud de presupuesto** (borrador) con el proveedor, las cantidades, el CMP como precio y el campo Origen = `UTILIA-REP-…`.
4. Run: `npm run sync` → el borrador NO debe aparecer en `PurchaseOrder` (el sync filtra confirmadas) y el pedido NO debe pasar a RECIBIDO.
5. **Prueba de cierre de ciclo (opcional pero recomendada):** confirmar esa orden de prueba en Odoo → `npm run sync` → el pedido en Utilia pasa a RECIBIDO. Luego cancelar/eliminar la orden de prueba en Odoo si no corresponde a una compra real, y borrar el pedido de prueba con Prisma Studio (`npm run db:studio`).
6. Si el RPC falla por permisos (la API key no puede crear compras), el toast de advertencia debe aparecer y el botón "Crear en Odoo" debe quedar visible en Pedidos en curso. Resolver permisos en Odoo (grupo Compras para el usuario de la API) y reintentar.

- [ ] **Step 7: Commit**

```bash
git add src/lib/odoo-write.ts src/lib/odoo.ts "src/app/(dashboard)/reabastecimiento/actions.ts" src/components/dashboard/ReplenishmentPending.tsx src/components/dashboard/ReplenishmentBoard.tsx
git commit -m "feat(reabastecimiento): borrador de orden de compra en Odoo al aprobar"
```

---

## Task 9: Navegación + verificación final (cierra F3)

**Files:**
- Modify: `src/components/layout/nav-config.tsx`
- Modify: `src/app/(dashboard)/inventario/page.tsx`
- Modify: `src/app/(dashboard)/compras/page.tsx`

**Interfaces:**
- Consumes: página de Task 7.
- Produces: entrada "Reabastecimiento" en sidebar y enlaces cruzados.

- [ ] **Step 1: Sidebar**

En `src/components/layout/nav-config.tsx`, agrega `ClipboardList` al import de lucide-react, y en `navItems` inserta después de la línea de Compras:

```ts
  { href: "/reabastecimiento", label: "Reabastecimiento", icon: ClipboardList },
```

- [ ] **Step 2: Enlace desde Inventario**

En `src/app/(dashboard)/inventario/page.tsx`, agrega `import Link from "next/link";` al inicio y reemplaza:

```tsx
      <h1 className="text-xl font-bold">Inteligencia de Inventario</h1>
```

por:

```tsx
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Inteligencia de Inventario</h1>
        <Link
          href="/reabastecimiento"
          className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
        >
          Generar pedido →
        </Link>
      </div>
```

- [ ] **Step 3: Enlace desde Compras**

En `src/app/(dashboard)/compras/page.tsx`, en el header, reemplaza:

```tsx
          <p className="text-xs text-muted-foreground mt-0.5">
            El dinero sigue la venta y la rotación — categorías más activas reciben más capital
          </p>
```

por:

```tsx
          <p className="text-xs text-muted-foreground mt-0.5">
            El dinero sigue la venta y la rotación — categorías más activas reciben más capital ·{" "}
            <Link href="/reabastecimiento" className="text-primary hover:underline">
              pedido por producto →
            </Link>
          </p>
```

(`Link` ya está importado en ese archivo.)

- [ ] **Step 4: Verificación final completa**

Run: `npx tsc --noEmit` → sin errores
Run: `npm run lint` → sin errores nuevos
Run: `npm run build` → build exitoso

Con `npm run dev`, recorrido completo:
1. Sidebar muestra "Reabastecimiento" y navega bien (desktop y móvil).
2. Enlaces desde Inventario y Compras funcionan.
3. Ciclo entero una vez más: sugerencia → ajustar → aprobar → borrador visible en Odoo → WhatsApp abre con el mensaje → marcar enviado → (tras confirmar en Odoo y sync) RECIBIDO.

- [ ] **Step 5: Commit final**

```bash
git add src/components/layout/nav-config.tsx "src/app/(dashboard)/inventario/page.tsx" "src/app/(dashboard)/compras/page.tsx"
git commit -m "feat(reabastecimiento): navegacion desde sidebar, inventario y compras"
```

---

## Notas de cierre

- **Deploy:** el deploy a Vercel se hace como siempre (push de la rama + preview). Antes del merge a `main`, correr una vez más el checklist de la Task 9 en el preview.
- **Pendiente consciente (fuera de este plan):** tarjeta-resumen en el dashboard principal (los archivos del dashboard tienen WIP ajeno); creación de productos nuevos; lead times y mínimos por proveedor; envío automático por 360dialog.
- **Operación:** la primera semana, comparar 2–3 pedidos sugeridos contra el criterio del dueño antes de confiar ciegamente; ajustar `minStock` de los productos estrella desde Odoo/BD si las cantidades se quedan cortas.
