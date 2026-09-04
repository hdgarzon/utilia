# Módulo de Productos — Fase 1 (Catálogo y edición masiva) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una página `/productos` que liste las 1.574 plantillas de producto de Odoo con filtros útiles, y permita aplicar cambios de categoría, proveedor, publicación e impuesto de compra a decenas de productos a la vez — sin que Utilia pueda mover inventario.

**Architecture:** El listado lee `product.template` en vivo de Odoo vía `search_read` (los filtros se traducen a dominios de Odoo) y se enriquece con `ProductInsight` desde Postgres para rotación y días de stock. Toda escritura pasa por `write-guard.ts`, un módulo puro con una lista blanca de campos que rechaza `qty_available`, `inventory_quantity` y `free_qty`, y prohíbe los modelos `stock.quant`, `stock.move` y `stock.inventory`.

**Tech Stack:** Next.js 16 App Router (React 19, server components + server actions), TypeScript, Prisma/Postgres, Tailwind 4, Zod 4, vitest (nuevo, solo lógica pura), Odoo 19 JSON-RPC.

**Spec:** `docs/superpowers/specs/2026-09-04-modulo-productos-design.md`

## Global Constraints

- **Utilia nunca genera movimientos de inventario.** Ni escribe `qty_available`, `inventory_quantity` o `free_qty`, ni toca los modelos `stock.quant`, `stock.move`, `stock.inventory`. Es la restricción central; todo lo demás se subordina a ella.
- **`standard_price` no se escribe en Fase 1.** Sobre un producto con stock dispara una revalorización contable. En Fase 1 no hay creación de productos, así que el costo simplemente no se escribe nunca.
- Toda escritura a Odoo se invoca **solo desde server actions disparadas por un clic**. Ningún sync, cron ni route handler importa el módulo de escritura. Mismo contrato que `src/lib/odoo-write.ts`.
- Timeout de escritura: `ODOO_WRITE_TIMEOUT_MS = 60_000` por llamada RPC. El cliente compartido (`src/lib/odoo.ts`) no tiene timeout por defecto a propósito y el camino de escritura no debe heredarlo.
- **Idioma:** UI, mensajes de error y comentarios de código en español. Commits en español **sin tildes**, formato `scope(area): resumen`.
- **Sin atribución de IA** en commits, ramas, PRs ni comentarios (regla de `CLAUDE.md`).
- **Nunca `git add -A` ni `git add .`** — siempre rutas explícitas.
- Rama de trabajo: `feat/modulo-productos` (ya creada, con el spec commiteado).

## File Structure

**Crear:**

| Archivo | Responsabilidad |
|---|---|
| `vitest.config.mts` | Config del runner: solo `src/**/*.test.ts`, alias `@/` |
| `src/lib/products/types.ts` | Tipos compartidos. Cero lógica, cero imports |
| `src/lib/products/write-guard.ts` | **La barrera.** Lista blanca, modelos prohibidos, traducción patch→Odoo. Puro, sin imports |
| `src/lib/products/write-guard.test.ts` | Prueba de la barrera |
| `src/lib/products/domain.ts` | `buildCatalogDomain(filters)`: filtros → dominio de Odoo. Puro |
| `src/lib/products/domain.test.ts` | Prueba de la traducción de filtros |
| `src/lib/products/catalog.ts` | Lectura: `listTemplates`, `getCatalogOptions` |
| `scripts/check-catalog.ts` | Diagnóstico de solo lectura: comprueba contra el Odoo real que la lectura del catálogo sigue viva |
| `src/lib/products/odoo-catalog-write.ts` | Escritura: `updateTemplates` con loteo y aislamiento de fallos |
| `src/lib/products/odoo-catalog-write.test.ts` | Prueba del loteo y la forma del resultado |
| `src/app/(dashboard)/productos/page.tsx` | Página del listado (server component) |
| `src/app/(dashboard)/productos/actions.ts` | Server actions de las acciones masivas |
| `src/components/products/CatalogTable.tsx` | Tabla con selección múltiple |
| `src/components/products/CatalogFilters.tsx` | Barra de filtros y búsqueda |
| `src/components/products/CatalogWorkspace.tsx` | Contenedor cliente: guarda la selección compartida entre tabla y barra |
| `src/components/products/BulkActionBar.tsx` | Barra que aparece con N seleccionados |
| `src/components/products/BulkActionDialog.tsx` | Confirmación, incluido el aviso de proveedor |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `package.json` | `vitest` en devDependencies, scripts `test` y `test:watch` |
| `src/components/layout/nav-config.tsx:16-28` | Entrada `Productos` entre Inventario y Categorías |
| `src/lib/odoo.ts` | Deduplicar la autenticación en vuelo (ver Task 3, § Autenticación concurrente) |

`write-guard.ts` y `domain.ts` se mantienen **sin imports** a propósito: son la lógica que hay que poder probar sin levantar Odoo, Prisma ni variables de entorno.

---

### Task 1: La barrera de inventario

Es la garantía central del diseño y va primero. Al terminar esta tarea existe una prueba que falla si alguien intenta escribir un campo de inventario.

**Files:**
- Create: `vitest.config.mts`
- Create: `src/lib/products/types.ts`
- Create: `src/lib/products/write-guard.ts`
- Test: `src/lib/products/write-guard.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nada (primera tarea).
- Produces:
  - `ProductType = "consu" | "service" | "combo"`
  - `CatalogProblem`, `CatalogFilters`, `CatalogRow`, `CatalogOptions`, `TemplatePatch`, `BulkResult` (tipos, en `types.ts`)
  - `assertWritable(values: Record<string, unknown>): void`
  - `assertModelAllowed(model: string): void`
  - `toOdooValues(patch: TemplatePatch): Record<string, unknown>`
  - `WRITABLE_FIELDS: ReadonlySet<string>`

- [ ] **Step 1: Instalar vitest y registrar los scripts**

```bash
npm install -D vitest
```

En `package.json`, dentro de `"scripts"`, agregar junto a `"lint"`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 2: Crear la configuración del runner**

`vitest.config.mts`:

```ts
import { defineConfig } from "vitest/config";

// Solo logica pura: nada de React, base de datos ni Odoo. Por eso el entorno
// es "node" y el include no alcanza componentes.
//
// Extension .mts, no .ts: el package.json no declara "type": "module" (y no
// debe hacerlo, cambiaria la resolucion de modulos de toda la app Next), asi
// que un .ts se cargaria como CommonJS y Vite avisaria. Por lo mismo el alias
// usa import.meta.dirname y no __dirname, que no existe en ESM.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": `${import.meta.dirname}/src` },
  },
});
```

- [ ] **Step 3: Crear los tipos compartidos**

`src/lib/products/types.ts`:

```ts
/** Tipos de producto en Odoo 19: Bienes / Servicio / Combo. */
export type ProductType = "consu" | "service" | "combo";

/** Filtros de "producto con problema" que el catalogo ofrece como atajo. */
export type CatalogProblem =
  | "sin_imagen"
  | "sin_categoria_web"
  | "sin_proveedor"
  | "sin_impuesto"
  | "sin_publicar";

export interface CatalogFilters {
  query?: string;
  categoryId?: number;
  publicCategoryId?: number;
  type?: ProductType;
  published?: boolean;
  problem?: CatalogProblem;
}

export interface CatalogRow {
  templateId: number;
  name: string;
  defaultCode: string | null;
  type: ProductType;
  isStorable: boolean;
  categoryId: number | null;
  categoryName: string | null;
  listPrice: number;
  /** Solo lectura. Utilia jamas escribe esta cifra. */
  qtyAvailable: number;
  isPublished: boolean;
  publicCategoryIds: number[];
  purchaseTaxIds: number[];
  supplierName: string | null;
  imageThumb: string | null;
  /** Enriquecido desde ProductInsight; null si el producto no esta en Postgres. */
  daysOfStock: number | null;
  rotationDays: number | null;
}

export interface CatalogOptions {
  categories: Array<{ id: number; name: string }>;
  publicCategories: Array<{ id: number; name: string }>;
  purchaseTaxes: Array<{ id: number; name: string }>;
  suppliers: Array<{ id: number; name: string }>;
}

/**
 * Intencion de cambio en lenguaje de la app, no de Odoo. `toOdooValues` la
 * traduce. NO incluye costo: escribirlo sobre un producto con stock dispara
 * una revalorizacion contable (ver spec).
 */
export interface TemplatePatch {
  categoryId?: number;
  publicCategoryIds?: number[];
  isPublished?: boolean;
  purchaseTaxIds?: number[];
  /** REEMPLAZA los proveedores existentes del producto (decision del dueño). */
  supplierPartnerId?: number;
}

export interface BulkResult {
  ok: number[];
  failed: Array<{ id: number; error: string }>;
}
```

- [ ] **Step 4: Escribir la prueba que falla**

`src/lib/products/write-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertWritable, assertModelAllowed, toOdooValues, WRITABLE_FIELDS } from "./write-guard";

describe("barrera de inventario", () => {
  it("rechaza los campos de cantidad", () => {
    for (const campo of ["qty_available", "inventory_quantity", "free_qty"]) {
      expect(() => assertWritable({ [campo]: 10 })).toThrow(/no permitido/i);
    }
  });

  it("rechaza un campo desconocido aunque venga junto a uno valido", () => {
    expect(() => assertWritable({ categ_id: 3, qty_available: 10 })).toThrow(/qty_available/);
  });

  it("acepta los campos de catalogo declarados", () => {
    expect(() => assertWritable({ categ_id: 3, is_published: true })).not.toThrow();
  });

  it("no deja entrar campos de inventario a la lista blanca", () => {
    for (const campo of ["qty_available", "inventory_quantity", "free_qty"]) {
      expect(WRITABLE_FIELDS.has(campo)).toBe(false);
    }
  });

  it("prohibe los modelos que mueven stock", () => {
    for (const modelo of ["stock.quant", "stock.move", "stock.inventory"]) {
      expect(() => assertModelAllowed(modelo)).toThrow(/inventario/i);
    }
    expect(() => assertModelAllowed("product.template")).not.toThrow();
  });
});

describe("toOdooValues", () => {
  it("omite las claves ausentes en vez de mandarlas vacias", () => {
    expect(toOdooValues({ isPublished: true })).toEqual({ is_published: true });
  });

  it("traduce categoria interna a categ_id", () => {
    expect(toOdooValues({ categoryId: 7 })).toEqual({ categ_id: 7 });
  });

  it("usa el comando 6 (reemplazar todo) en los many2many", () => {
    expect(toOdooValues({ publicCategoryIds: [1, 2] })).toEqual({
      public_categ_ids: [[6, 0, [1, 2]]],
    });
    expect(toOdooValues({ purchaseTaxIds: [4] })).toEqual({
      supplier_taxes_id: [[6, 0, [4]]],
    });
  });

  it("reemplaza los proveedores existentes: limpia y crea", () => {
    expect(toOdooValues({ supplierPartnerId: 42 })).toEqual({
      seller_ids: [
        [5, 0, 0],
        [0, 0, { partner_id: 42 }],
      ],
    });
  });

  it("produce solo campos que la barrera acepta", () => {
    const valores = toOdooValues({
      categoryId: 1,
      publicCategoryIds: [2],
      isPublished: true,
      purchaseTaxIds: [3],
      supplierPartnerId: 4,
    });
    expect(() => assertWritable(valores)).not.toThrow();
  });
});
```

- [ ] **Step 5: Correr la prueba y verificar que falla**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./write-guard"`.

- [ ] **Step 6: Escribir la barrera**

`src/lib/products/write-guard.ts`:

```ts
import type { TemplatePatch } from "./types";

/**
 * Barrera de escritura del catalogo. Sin imports de Odoo, Prisma ni entorno:
 * tiene que poder probarse sola, porque es la garantia de que Utilia nunca
 * mueve inventario en produccion.
 *
 * La lista es EXACTAMENTE lo que el modulo escribe hoy, ni un campo mas:
 * los cinco que produce `toOdooValues`. `qty_available`,
 * `inventory_quantity` y `free_qty` quedan fuera por construccion.
 *
 * Regla para mantenerla: un campo entra a esta lista en el MISMO cambio que
 * introduce quien lo escribe, nunca antes. Una lista con campos sin escritor
 * es una puerta abierta sin nadie que la use.
 *
 * Por eso no estan todavia los campos de creacion de producto (`name`,
 * `type`, `is_storable`, `list_price`, `image_1920`, `show_availability`,
 * `standard_price`): los escribe `createTemplate`, que es Fase 2. Dos de
 * ellos son delicados y merecen mencion aparte: `is_storable` ES el rastreo
 * de inventario, y escribir `standard_price` sobre un producto con stock
 * dispara una revalorizacion contable en Odoo (seguro solo al crear, con
 * stock en 0). `list_price` ademas quedo fuera de la edicion masiva de la
 * v1 por prudencia comercial (ver spec).
 */
export const WRITABLE_FIELDS: ReadonlySet<string> = new Set([
  "categ_id",
  "is_published",
  "public_categ_ids",
  "supplier_taxes_id",
  "seller_ids",
]);

/** Escribir en cualquiera de estos genera movimiento de inventario. */
const FORBIDDEN_MODELS: ReadonlySet<string> = new Set([
  "stock.quant",
  "stock.move",
  "stock.inventory",
]);

export function assertWritable(values: Record<string, unknown>): void {
  for (const campo of Object.keys(values)) {
    if (!WRITABLE_FIELDS.has(campo)) {
      throw new Error(`Campo no permitido en escritura de catalogo: ${campo}`);
    }
  }
}

export function assertModelAllowed(model: string): void {
  if (FORBIDDEN_MODELS.has(model)) {
    throw new Error(`Modelo prohibido: ${model} — este modulo no puede tocar inventario`);
  }
}

/**
 * Traduce la intencion de la app a valores de Odoo. Las claves ausentes en el
 * patch no aparecen en el resultado: un `undefined` enviado a Odoo borraria
 * el valor existente.
 */
export function toOdooValues(patch: TemplatePatch): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  if (patch.categoryId !== undefined) v.categ_id = patch.categoryId;
  if (patch.isPublished !== undefined) v.is_published = patch.isPublished;
  // Comando 6 de Odoo: reemplazar el conjunto completo del many2many.
  if (patch.publicCategoryIds !== undefined) v.public_categ_ids = [[6, 0, patch.publicCategoryIds]];
  if (patch.purchaseTaxIds !== undefined) v.supplier_taxes_id = [[6, 0, patch.purchaseTaxIds]];
  // Comando 5 (limpiar) + 0 (crear): el proveedor nuevo REEMPLAZA a los que
  // hubiera. Es destructivo a proposito; la UI avisa antes de confirmar.
  if (patch.supplierPartnerId !== undefined) {
    v.seller_ids = [
      [5, 0, 0],
      [0, 0, { partner_id: patch.supplierPartnerId }],
    ];
  }
  return v;
}
```

- [ ] **Step 7: Correr la prueba y verificar que pasa**

Run: `npm test`
Expected: PASS — 11 pruebas.

- [ ] **Step 8: Verificar que no se rompió nada**

Run: `npm run lint && npm run build`
Expected: ambos sin errores.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.mts src/lib/products/types.ts src/lib/products/write-guard.ts src/lib/products/write-guard.test.ts
git commit -m "feat(productos): barrera de escritura que excluye inventario"
```

---

### Task 2: Traducción de filtros a dominios de Odoo

**Files:**
- Create: `src/lib/products/domain.ts`
- Test: `src/lib/products/domain.test.ts`

**Interfaces:**
- Consumes: `CatalogFilters`, `CatalogProblem` de `./types` (Task 1).
- Produces: `buildCatalogDomain(filters: CatalogFilters): unknown[]`

Contexto que el implementador necesita: los dominios de Odoo son notación prefija. `["|", A, B, C]` significa `(A OR B) AND C`. Los términos sin operador se unen con AND implícito.

- [ ] **Step 1: Escribir la prueba que falla**

`src/lib/products/domain.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCatalogDomain } from "./domain";

describe("buildCatalogDomain", () => {
  it("sin filtros devuelve un dominio vacio", () => {
    expect(buildCatalogDomain({})).toEqual([]);
  });

  it("la busqueda cubre nombre y referencia interna con OR", () => {
    expect(buildCatalogDomain({ query: "cuaderno" })).toEqual([
      "|",
      ["name", "ilike", "cuaderno"],
      ["default_code", "ilike", "cuaderno"],
    ]);
  });

  it("ignora una busqueda de solo espacios", () => {
    expect(buildCatalogDomain({ query: "   " })).toEqual([]);
  });

  it("recorta los espacios de la busqueda", () => {
    expect(buildCatalogDomain({ query: "  lapiz " })).toEqual([
      "|",
      ["name", "ilike", "lapiz"],
      ["default_code", "ilike", "lapiz"],
    ]);
  });

  it("filtra por categoria interna y por tipo", () => {
    expect(buildCatalogDomain({ categoryId: 5, type: "service" })).toEqual([
      ["categ_id", "=", 5],
      ["type", "=", "service"],
    ]);
  });

  it("filtra por categoria de ecommerce con el operador in", () => {
    expect(buildCatalogDomain({ publicCategoryId: 9 })).toEqual([
      ["public_categ_ids", "in", [9]],
    ]);
  });

  it("distingue publicado false de publicado ausente", () => {
    expect(buildCatalogDomain({ published: false })).toEqual([["is_published", "=", false]]);
    expect(buildCatalogDomain({})).toEqual([]);
  });

  it("traduce cada filtro de problema", () => {
    expect(buildCatalogDomain({ problem: "sin_imagen" })).toEqual([["image_1920", "=", false]]);
    expect(buildCatalogDomain({ problem: "sin_categoria_web" })).toEqual([
      ["public_categ_ids", "=", false],
    ]);
    expect(buildCatalogDomain({ problem: "sin_proveedor" })).toEqual([["seller_ids", "=", false]]);
    expect(buildCatalogDomain({ problem: "sin_impuesto" })).toEqual([
      ["supplier_taxes_id", "=", false],
    ]);
    expect(buildCatalogDomain({ problem: "sin_publicar" })).toEqual([["is_published", "=", false]]);
  });

  it("combina busqueda con filtros: el OR aplica solo a sus dos terminos", () => {
    expect(buildCatalogDomain({ query: "vela", categoryId: 2 })).toEqual([
      "|",
      ["name", "ilike", "vela"],
      ["default_code", "ilike", "vela"],
      ["categ_id", "=", 2],
    ]);
  });
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npm test -- domain`
Expected: FAIL — `Failed to resolve import "./domain"`.

- [ ] **Step 3: Escribir la traducción**

`src/lib/products/domain.ts`:

```ts
import type { CatalogFilters } from "./types";

/**
 * Traduce los filtros de la UI a un dominio de Odoo.
 *
 * Los dominios de Odoo son notacion prefija: ["|", A, B, C] es (A OR B) AND C.
 * Los terminos sin operador se unen con AND implicito, por eso el bloque de
 * busqueda puede ir primero y el resto acumularse detras.
 */
export function buildCatalogDomain(f: CatalogFilters): unknown[] {
  const domain: unknown[] = [];

  const q = f.query?.trim();
  if (q) {
    domain.push("|", ["name", "ilike", q], ["default_code", "ilike", q]);
  }

  if (f.categoryId !== undefined) domain.push(["categ_id", "=", f.categoryId]);
  if (f.publicCategoryId !== undefined) domain.push(["public_categ_ids", "in", [f.publicCategoryId]]);
  if (f.type !== undefined) domain.push(["type", "=", f.type]);
  if (f.published !== undefined) domain.push(["is_published", "=", f.published]);

  switch (f.problem) {
    case "sin_imagen":
      domain.push(["image_1920", "=", false]);
      break;
    case "sin_categoria_web":
      domain.push(["public_categ_ids", "=", false]);
      break;
    case "sin_proveedor":
      domain.push(["seller_ids", "=", false]);
      break;
    case "sin_impuesto":
      domain.push(["supplier_taxes_id", "=", false]);
      break;
    case "sin_publicar":
      domain.push(["is_published", "=", false]);
      break;
  }

  return domain;
}
```

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `npm test`
Expected: PASS — las 11 de Task 1 más 9 nuevas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/products/domain.ts src/lib/products/domain.test.ts
git commit -m "feat(productos): traduccion de filtros a dominios de odoo"
```

---

### Task 3: Lectura del catálogo

**Files:**
- Create: `src/lib/products/catalog.ts`

**Interfaces:**
- Consumes: `buildCatalogDomain` (Task 2); `CatalogFilters`, `CatalogRow`, `CatalogOptions`, `ProductType` (Task 1); `odooRpc.searchRead` de `@/lib/odoo`; `prisma` de `@/lib/prisma`.
- Produces:
  - `listTemplates(filters: CatalogFilters, page: number): Promise<{ rows: CatalogRow[]; total: number }>`
  - `getCatalogOptions(): Promise<CatalogOptions>`
  - `PAGE_SIZE: number` (50)

Contexto: en `search_read` de Odoo, un many2one llega como `[id, nombre]` o `false`; un many2many como `number[]`. `image_128` llega como base64 sin prefijo o `false`.

- [ ] **Step 1: Escribir el módulo de lectura**

`src/lib/products/catalog.ts`:

```ts
import { odooRpc } from "@/lib/odoo";
import { prisma } from "@/lib/prisma";
import { buildCatalogDomain } from "./domain";
import type { CatalogFilters, CatalogOptions, CatalogRow, ProductType } from "./types";

export const PAGE_SIZE = 50;

/** Campos que el listado pide a Odoo. Solo lectura. */
const CATALOG_FIELDS = [
  "id",
  "name",
  "default_code",
  "type",
  "is_storable",
  "categ_id",
  "list_price",
  "qty_available",
  "is_published",
  "public_categ_ids",
  "supplier_taxes_id",
  "image_128",
];

interface RawTemplate {
  id: number;
  name: string;
  default_code: string | false;
  type: ProductType;
  is_storable: boolean;
  categ_id: [number, string] | false;
  list_price: number;
  qty_available: number;
  is_published: boolean;
  public_categ_ids: number[];
  supplier_taxes_id: number[];
  image_128: string | false;
}

/**
 * Lee una pagina del catalogo directo de Odoo y la enriquece con la analitica
 * que vive en Postgres.
 *
 * Se lee en vivo y no de una tabla espejo por dos razones: todo lo editable
 * vive en product.template (ProductInsight es a nivel de variante y no guarda
 * imagen, tipo, impuesto ni proveedor), y despues de un cambio masivo la tabla
 * tiene que mostrar la verdad de inmediato, no la del ultimo sync.
 */
export async function listTemplates(
  filters: CatalogFilters,
  page: number
): Promise<{ rows: CatalogRow[]; total: number }> {
  const domain = buildCatalogDomain(filters);
  const offset = Math.max(0, page - 1) * PAGE_SIZE;

  const [raw, total] = await Promise.all([
    odooRpc.searchRead<RawTemplate>("product.template", domain, CATALOG_FIELDS, {
      limit: PAGE_SIZE,
      offset,
      order: "name asc",
    }),
    odooRpc.executeKw<number>("product.template", "search_count", [domain]),
  ]);

  const templateIds = raw.map((t) => t.id);

  // El nombre del proveedor no viene en product.template: seller_ids apunta a
  // product.supplierinfo. Una consulta extra por pagina, no por producto.
  //
  // En paralelo: una consulta va a Odoo y la otra a Postgres, no dependen
  // entre si. Encadenarlas con dos await seguidos seria una cascada gratuita.
  const [supplierByTemplate, insightByTemplate] = await Promise.all([
    getSupplierNames(templateIds),
    getInsights(templateIds),
  ]);

  const rows = raw.map((t): CatalogRow => {
    const insight = insightByTemplate.get(t.id);
    return {
      templateId: t.id,
      name: t.name,
      defaultCode: t.default_code || null,
      type: t.type,
      isStorable: t.is_storable,
      categoryId: t.categ_id ? t.categ_id[0] : null,
      categoryName: t.categ_id ? t.categ_id[1] : null,
      listPrice: t.list_price,
      qtyAvailable: t.qty_available,
      isPublished: t.is_published,
      publicCategoryIds: t.public_categ_ids ?? [],
      purchaseTaxIds: t.supplier_taxes_id ?? [],
      supplierName: supplierByTemplate.get(t.id) ?? null,
      imageThumb: t.image_128 ? `data:image/png;base64,${t.image_128}` : null,
      daysOfStock: insight?.daysOfStock ?? null,
      rotationDays: insight?.rotationDays ?? null,
    };
  });

  return { rows, total };
}

/** Primer proveedor de cada plantilla, por orden de prioridad de Odoo. */
async function getSupplierNames(templateIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (templateIds.length === 0) return out;

  const infos = await odooRpc.searchRead<{
    product_tmpl_id: [number, string] | false;
    partner_id: [number, string] | false;
  }>(
    "product.supplierinfo",
    [["product_tmpl_id", "in", templateIds]],
    ["product_tmpl_id", "partner_id"],
    { limit: 1000, order: "sequence asc, id asc" }
  );

  for (const info of infos) {
    if (!info.product_tmpl_id || !info.partner_id) continue;
    const tmplId = info.product_tmpl_id[0];
    if (!out.has(tmplId)) out.set(tmplId, info.partner_id[1]);
  }
  return out;
}

/**
 * Rotacion y cobertura desde ProductInsight, que es por VARIANTE. Una plantilla
 * con varias variantes se resume con la peor cobertura (el minimo daysOfStock),
 * que es la que manda para decidir si hay que reponer.
 */
async function getInsights(
  templateIds: number[]
): Promise<Map<number, { daysOfStock: number; rotationDays: number }>> {
  const out = new Map<number, { daysOfStock: number; rotationDays: number }>();
  if (templateIds.length === 0) return out;

  const insights = await prisma.productInsight.findMany({
    where: { odooTemplateId: { in: templateIds } },
    select: { odooTemplateId: true, daysOfStock: true, rotationDays: true },
  });

  for (const i of insights) {
    if (i.odooTemplateId === null) continue;
    const prev = out.get(i.odooTemplateId);
    if (!prev || i.daysOfStock < prev.daysOfStock) {
      out.set(i.odooTemplateId, { daysOfStock: i.daysOfStock, rotationDays: i.rotationDays });
    }
  }
  return out;
}

/**
 * Catalogos de referencia para filtros y dialogos. Se piden en paralelo; son
 * listas cortas (24 categorias, 14 web, 20 impuestos, 24 proveedores).
 */
export async function getCatalogOptions(): Promise<CatalogOptions> {
  const [categories, publicCategories, purchaseTaxes, suppliers] = await Promise.all([
    odooRpc.searchRead<{ id: number; complete_name: string }>(
      "product.category",
      [],
      ["id", "complete_name"],
      { limit: 200, order: "complete_name asc" }
    ),
    odooRpc.searchRead<{ id: number; name: string }>(
      "product.public.category",
      [],
      ["id", "name"],
      { limit: 200, order: "name asc" }
    ),
    odooRpc.searchRead<{ id: number; name: string }>(
      "account.tax",
      [["type_tax_use", "=", "purchase"]],
      ["id", "name"],
      { limit: 200, order: "name asc" }
    ),
    odooRpc.searchRead<{ id: number; name: string }>(
      "res.partner",
      [["supplier_rank", ">", 0]],
      ["id", "name"],
      { limit: 500, order: "name asc" }
    ),
  ]);

  return {
    categories: categories.map((c) => ({ id: c.id, name: c.complete_name })),
    publicCategories,
    purchaseTaxes,
    suppliers,
  };
}
```

- [ ] **Step 2: Verificar contra el Odoo real**

El script se queda en el repo como herramienta de diagnóstico: sirve para comprobar de un vistazo que la lectura del catálogo sigue viva después de un cambio en Odoo, y no hay razón para tirarlo tras usarlo una vez. Es de **solo lectura**.

Crear `scripts/check-catalog.ts`:

```ts
import { listTemplates, getCatalogOptions } from "../src/lib/products/catalog";

(async () => {
  const opts = await getCatalogOptions();
  console.log("categorias:", opts.categories.length, "| web:", opts.publicCategories.length,
              "| impuestos:", opts.purchaseTaxes.length, "| proveedores:", opts.suppliers.length);

  const primera = await listTemplates({}, 1);
  console.log("total:", primera.total, "| filas:", primera.rows.length);
  console.log(primera.rows.slice(0, 3).map((r) => ({
    id: r.templateId, nombre: r.name, cat: r.categoryName,
    proveedor: r.supplierName, img: !!r.imageThumb, stock: r.qtyAvailable,
  })));

  const sinImagen = await listTemplates({ problem: "sin_imagen" }, 1);
  console.log("sin imagen:", sinImagen.total, "(esperado ~43)");

  const busqueda = await listTemplates({ query: "cuaderno" }, 1);
  console.log("busqueda 'cuaderno':", busqueda.total);
})();
```

Registrarlo en `package.json`, junto a los otros scripts de diagnostico que ya usan `tsx --env-file`:

```json
    "check:catalog": "tsx --env-file=.env.local scripts/check-catalog.ts",
```

Run: `npm run check:catalog`

Expected (foto del 2026-09-04, el catálogo se mueve): `total` ≈ 1.588, `filas: 50`, categorías 24, web 14, impuestos de compra 44, proveedores 24, `sin imagen` ≈ 46. Las primeras filas deben mostrar nombre y categoría reales.

Los conteos exactos van a diferir según el día — lo que importa es el orden de magnitud y que ninguna lista venga vacía. Nótese que `search_count` sobre `product.template` cuenta solo las **activas**: hay ~998 plantillas archivadas que el catálogo no debe mostrar, y ese es el comportamiento correcto.

- [ ] **Step 3: Confirmar que no se filtró ningún secreto**

El script lee credenciales de `.env.local` por el flag `--env-file`, pero no debe contener ninguna. Verificar que no hay URLs, llaves ni logins escritos a mano en el archivo, y que `.env.local` no quedó preparado para commit:

Run: `grep -nE "ODOO_|SUPABASE|DATABASE_URL|sk-|api_key" scripts/check-catalog.ts; git status --short`
Expected: el grep no encuentra nada, y `.env.local` no aparece en el estado.

- [ ] **Step 4: Verificar tipos y lint**

Run: `npm run lint && npm run build`
Expected: ambos sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/products/catalog.ts scripts/check-catalog.ts package.json
git commit -m "feat(productos): lectura del catalogo desde odoo con enriquecimiento local"
```

---

#### Autenticación concurrente — corrección obligatoria en `src/lib/odoo.ts`

`authenticate()` cachea el **uid resuelto**, no la promesa en vuelo:

```ts
async function authenticate(timeoutMs?: number): Promise<number> {
  if (cachedUid !== null) return cachedUid;
  const uid = await jsonRpc<number | false>("common", "authenticate", [...]);
```

Sobre un proceso frío, N llamadas concurrentes ven `cachedUid === null` a la vez y disparan **N autenticaciones simultáneas**. `getCatalogOptions` lanza 4 `searchRead` en paralelo y `listTemplates` otras 2: hasta 6 autenticaciones por arranque en frío.

Odoo.sh estrangula ese endpoint. Verificado contra la instancia real: 4 autenticaciones en paralelo devuelven **HTTP 429** de forma reproducible incluso tras 30 s de enfriamiento, mientras que una sola autenticación seguida de 4 lecturas en paralelo funciona sin problema. En Vercel esto rompería `/productos` en cada arranque en frío.

Cambiar `src/lib/odoo.ts` para cachear la promesa:

```ts
let cachedUid: number | null = null;
let pendingAuth: Promise<number> | null = null;

async function authenticate(timeoutMs?: number): Promise<number> {
  if (cachedUid !== null) return cachedUid;
  // Sin esta deduplicacion, N llamadas concurrentes sobre un proceso frio
  // disparan N autenticaciones simultaneas. Odoo.sh responde 429 a esa rafaga
  // y tumba la pagina entera en cada arranque en frio.
  if (pendingAuth !== null) return pendingAuth;

  pendingAuth = (async () => {
    const uid = await jsonRpc<number | false>(
      "common",
      "authenticate",
      [ODOO_DB, ODOO_LOGIN, ODOO_API_KEY, {}],
      timeoutMs
    );
    if (uid === false || uid === 0) {
      throw new Error(
        `Odoo authentication failed. Verifica ODOO_DB="${ODOO_DB}", ODOO_LOGIN y ODOO_API_KEY.`
      );
    }
    cachedUid = uid as number;
    return cachedUid;
  })();

  try {
    return await pendingAuth;
  } finally {
    // Se libera pase lo que pase: si la autenticacion fallo, el proximo
    // llamador debe poder reintentar en vez de heredar para siempre una
    // promesa rechazada.
    pendingAuth = null;
  }
}
```

Es una mejora estricta y también beneficia al sync, que comparte este cliente. Prueba en `src/lib/odoo.test.ts` que lo fija: con `fetch` mockeado, cuatro llamadas concurrentes que necesiten uid deben producir **una sola** petición de `authenticate`.

---

#### Tope de concurrencia — segunda corrección obligatoria en `src/lib/odoo.ts`

Medido contra la instancia real (sin cabeceras de límite de ningún tipo, hay que descubrirlo probando):

| Patrón | Resultado |
|---|---|
| 8 peticiones en **secuencia**, sin pausa | todas 200 — no hay límite de volumen |
| 4 en **paralelo** | todas 200 |
| 6 en paralelo | 1 de 6 → **HTTP 429** |
| 8 en paralelo | 3 de 8 → **HTTP 429** |
| 4 autenticaciones en paralelo | 1 de 4 → **HTTP 429** |

Odoo.sh corta alrededor de las 5 concurrentes. La página dispara `Promise.all([listTemplates, getCatalogOptions])`: 4 lecturas de las opciones más 2 del listado = **6 simultáneas**, justo en la zona de fallo. De ahí los 429 intermitentes e irreproducibles durante el desarrollo — y lo mismo pasaría en producción.

La solución no es quitar el paralelismo (en secuencia no hay límite, pero serializar todo cuesta latencia sin necesidad) sino **acotarlo**. Un semáforo en `src/lib/odoo.ts`, en `jsonRpc`, que es el único punto donde ocurre el `fetch`:

```ts
/**
 * Tope de peticiones simultaneas contra Odoo.
 *
 * Medido contra la instancia real: en secuencia no hay limite (8 seguidas sin
 * pausa pasan), 4 en paralelo pasan, 6 pierden 1 con HTTP 429 y 8 pierden 3.
 * Odoo.sh corta alrededor de las 5 concurrentes y NO envia ninguna cabecera de
 * limite, asi que el respeto tiene que venir de este lado.
 *
 * 3 deja margen bajo el umbral medido sin costar latencia perceptible: las
 * cuatro lecturas de getCatalogOptions pasan en dos tandas.
 */
const MAX_CONCURRENT_REQUESTS = 3;

let activeRequests = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  activeRequests++;
  try {
    return await fn();
  } finally {
    activeRequests--;
    waiting.shift()?.();
  }
}
```

`jsonRpc` envuelve su `fetch` con `withSlot`. **No** envolver `executeKw`: llama a `authenticate` y luego a `jsonRpc`, y anidar dos tomas de turno se bloquearía a sí mismo. `jsonRpc` es el punto correcto porque cada toma se libera antes de la siguiente.

Beneficia también al sync, que comparte el cliente y hoy pagina productos en lotes.

Prueba en `src/lib/odoo.test.ts`: con `fetch` mockeado y un retardo, lanzar 8 llamadas concurrentes y afirmar que el máximo de peticiones simultáneas observadas nunca pasa de 3.

---

### Task 4: Página de listado con filtros

Al terminar esta tarea `/productos` ya sirve: es software entregable aunque no se toque nada más.

**Files:**
- Create: `src/app/(dashboard)/productos/page.tsx`
- Create: `src/components/products/CatalogFilters.tsx`
- Create: `src/components/products/CatalogTable.tsx`
- Modify: `src/components/layout/nav-config.tsx`

**Interfaces:**
- Consumes: `listTemplates`, `getCatalogOptions`, `PAGE_SIZE` (Task 3); `CatalogRow`, `CatalogFilters`, `CatalogOptions`, `CatalogProblem` (Task 1); `FilterChip` de `@/components/dashboard/table-controls`; `formatCurrency` de `@/lib/utils`.
- Produces:
  - `<CatalogFilters options={...} filters={...} total={number} />` — client component; escribe los filtros en la query string con `useRouter`.
  - `<CatalogTable rows={CatalogRow[]} />` — client component; en Task 6 se le agregan `selected` y `onSelectionChange`.

Los filtros viven en la URL (`?q=&cat=&web=&tipo=&pub=&prob=&page=`) para que el server component los lea de `searchParams` y la página sea compartible y recargable.

- [ ] **Step 1: Crear la barra de filtros**

`src/components/products/CatalogFilters.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { FilterChip } from "@/components/dashboard/table-controls";
import type { CatalogOptions, CatalogProblem } from "@/lib/products/types";

const PROBLEMAS: Array<{ key: CatalogProblem; label: string }> = [
  { key: "sin_imagen", label: "Sin imagen" },
  { key: "sin_categoria_web", label: "Sin categoría web" },
  { key: "sin_proveedor", label: "Sin proveedor" },
  { key: "sin_impuesto", label: "Sin impuesto" },
  { key: "sin_publicar", label: "Sin publicar" },
];

const TIPOS = [
  { key: "consu", label: "Bienes" },
  { key: "service", label: "Servicio" },
  { key: "combo", label: "Combo" },
];

export function CatalogFilters({ options, total }: { options: CatalogOptions; total: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(params.get("q") ?? "");

  // Cada cambio de filtro vuelve a la pagina 1: mantener el offset viejo
  // mostraria una pagina vacia cuando el filtro nuevo devuelve menos filas.
  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    next.delete("page");
    startTransition(() => router.push(`/productos?${next.toString()}`));
  }

  const problema = params.get("prob");
  const tipo = params.get("tipo");
  const hayFiltros = Array.from(params.keys()).some((k) => k !== "page");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", query);
          }}
          className="relative flex-1 min-w-[220px]"
        >
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o referencia…"
            aria-label="Buscar productos por nombre o referencia"
            className="w-full rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-xs outline-none focus:border-primary"
          />
        </form>

        <select
          value={params.get("cat") ?? ""}
          onChange={(e) => setParam("cat", e.target.value)}
          aria-label="Filtrar por categoría interna"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
        >
          <option value="">Toda categoría</option>
          {options.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          value={params.get("web") ?? ""}
          onChange={(e) => setParam("web", e.target.value)}
          aria-label="Filtrar por categoría de ecommerce"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
        >
          <option value="">Toda categoría web</option>
          {options.publicCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {TIPOS.map((t) => (
          <FilterChip
            key={t.key}
            label={t.label}
            active={tipo === t.key}
            onClick={() => setParam("tipo", tipo === t.key ? null : t.key)}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {PROBLEMAS.map((p) => (
          <FilterChip
            key={p.key}
            label={p.label}
            tone="warning"
            active={problema === p.key}
            onClick={() => setParam("prob", problema === p.key ? null : p.key)}
          />
        ))}
        {hayFiltros && (
          <button
            onClick={() => startTransition(() => router.push("/productos"))}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary"
          >
            <X className="h-3 w-3" /> Limpiar
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {pending ? "Cargando…" : `${total.toLocaleString("es-CO")} productos`}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Crear la tabla**

`src/components/products/CatalogTable.tsx`:

```tsx
"use client";

import { formatCurrency, cn } from "@/lib/utils";
import { ImageOff, Package } from "lucide-react";
import type { CatalogRow } from "@/lib/products/types";

const TIPO_LABEL: Record<CatalogRow["type"], string> = {
  consu: "Bienes",
  service: "Servicio",
  combo: "Combo",
};

export function CatalogTable({ rows }: { rows: CatalogRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <Package className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Ningún producto coincide con estos filtros.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            <th className="py-2 px-3 text-left font-medium">Producto</th>
            <th className="py-2 px-3 text-left font-medium">Categoría</th>
            <th className="py-2 px-3 text-left font-medium">Proveedor</th>
            <th className="py-2 px-3 text-right font-medium">Precio</th>
            <th className="py-2 px-3 text-right font-medium">Stock</th>
            <th className="py-2 px-3 text-center font-medium">Tipo</th>
            <th className="py-2 px-3 text-center font-medium">Web</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.templateId} className="border-b border-border last:border-0 hover:bg-secondary/40">
              <td className="py-2 px-3">
                <div className="flex items-center gap-2">
                  {r.imageThumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageThumb} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                  ) : (
                    <span className="grid h-8 w-8 place-items-center rounded bg-secondary shrink-0">
                      <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium truncate max-w-[280px]">{r.name}</p>
                    {r.defaultCode ? <p className="text-muted-foreground">{r.defaultCode}</p> : null}
                  </div>
                </div>
              </td>
              <td className="py-2 px-3 text-muted-foreground">{r.categoryName ?? "—"}</td>
              <td className={cn("py-2 px-3", r.supplierName ? "text-muted-foreground" : "text-warning")}>
                {r.supplierName ?? "Sin proveedor"}
              </td>
              <td className="py-2 px-3 text-right font-medium">{formatCurrency(r.listPrice)}</td>
              <td className="py-2 px-3 text-right text-muted-foreground">
                {r.type === "service" ? "—" : r.qtyAvailable.toFixed(0)}
              </td>
              <td className="py-2 px-3 text-center text-muted-foreground">{TIPO_LABEL[r.type]}</td>
              <td className="py-2 px-3 text-center">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    r.isPublished ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
                  )}
                >
                  {r.isPublished ? "Publicado" : "Oculto"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Se usa `<img>` y no `next/image` a propósito: la miniatura llega como data URI en base64 desde Odoo, y el optimizador de Next no aporta nada sobre un data URI ya redimensionado a 128px.

**Sobre el peso de la página:** las 50 miniaturas viajan en base64 dentro del payload del server component, unos 150–400 KB por página. Es el precio de no depender de `/web/image` de Odoo, que exige sesión autenticada y no serviría las miniaturas de productos sin publicar. Si alguna vez molesta, la salida no es paginar menos sino servir las miniaturas por un route handler propio que haga de proxy autenticado — pero eso es trabajo que hoy no se justifica.

- [ ] **Step 3: Crear la página**

`src/app/(dashboard)/productos/page.tsx`:

```tsx
export const dynamic = "force-dynamic";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { listTemplates, getCatalogOptions, PAGE_SIZE } from "@/lib/products/catalog";
import { CatalogFilters } from "@/components/products/CatalogFilters";
import { CatalogTable } from "@/components/products/CatalogTable";
import type { CatalogFilters as Filters, CatalogProblem, ProductType } from "@/lib/products/types";

const PROBLEMAS_VALIDOS: CatalogProblem[] = [
  "sin_imagen",
  "sin_categoria_web",
  "sin_proveedor",
  "sin_impuesto",
  "sin_publicar",
];
const TIPOS_VALIDOS: ProductType[] = ["consu", "service", "combo"];

function numeroOpcional(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// La pagina viene de la URL, que es compartible y editable a mano. Un valor
// fraccionario como ?page=1.3 llegaria a Odoo como un offset con decimales, y
// se mostraria tal cual en "Pagina 1.3 de N". Se exige entero positivo.
function paginaValida(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const uno = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : (sp[k] as string | undefined));
  const tipo = uno("tipo");
  const prob = uno("prob");
  const pub = uno("pub");
  return {
    query: uno("q"),
    categoryId: numeroOpcional(uno("cat")),
    publicCategoryId: numeroOpcional(uno("web")),
    type: TIPOS_VALIDOS.includes(tipo as ProductType) ? (tipo as ProductType) : undefined,
    published: pub === "1" ? true : pub === "0" ? false : undefined,
    problem: PROBLEMAS_VALIDOS.includes(prob as CatalogProblem) ? (prob as CatalogProblem) : undefined,
  };
}

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const page = paginaValida(Array.isArray(sp.page) ? sp.page[0] : sp.page);

  let data: Awaited<ReturnType<typeof listTemplates>> | null = null;
  let options: Awaited<ReturnType<typeof getCatalogOptions>> | null = null;
  let error: string | null = null;

  try {
    [data, options] = await Promise.all([listTemplates(filters, page), getCatalogOptions()]);
  } catch (err) {
    console.error("[productos] fallo la lectura del catalogo:", err);
    error = "No se pudo leer el catálogo de Odoo. Revisa la conexión e intenta de nuevo.";
  }

  if (error || !data || !options) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Productos</h1>
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm text-destructive">{error}</p>
            <Link href="/productos" className="text-xs font-medium text-primary hover:underline">
              Reintentar
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const totalPaginas = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  // Conserva exactamente el valor que uso parseFilters. Filtrar por
  // `typeof v === "string"` perderia los parametros repetidos (?cat=3&cat=5),
  // que parseFilters SI acepta tomando el primero: la pagina mostraria el
  // filtro aplicado pero el enlace a la siguiente lo dejaria caer.
  const qs = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (k === "page") continue;
      const valor = Array.isArray(v) ? v[0] : v;
      if (valor) next.set(k, valor);
    }
    next.set("page", String(p));
    return `/productos?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Productos</h1>

      <CatalogFilters options={options} total={data.total} />
      <CatalogTable rows={data.rows} />

      {totalPaginas > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Página {page} de {totalPaginas}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={qs(page - 1)} className="rounded-lg border border-border px-3 py-1.5 hover:bg-secondary">
                ← Anterior
              </Link>
            )}
            {page < totalPaginas && (
              <Link href={qs(page + 1)} className="rounded-lg border border-border px-3 py-1.5 hover:bg-secondary">
                Siguiente →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Agregar la entrada al menú**

En `src/components/layout/nav-config.tsx`, agregar `Boxes` al import de `lucide-react` y esta línea al array `navItems`, **inmediatamente después** de la de Inventario:

```tsx
  { href: "/productos", label: "Productos", icon: Boxes },
```

- [ ] **Step 5: Verificar en el navegador**

Levantar el servidor de desarrollo y abrir `/productos`. Comprobar:
1. La tabla carga 50 filas con miniatura, categoría y precio reales.
2. El contador dice 1.574 productos.
3. El chip "Sin proveedor" reduce el total y la columna Proveedor queda en ámbar.
4. Buscar "cuaderno" filtra, y "Limpiar" restaura.
5. "Siguiente →" avanza y conserva los filtros en la URL.
6. La entrada Productos aparece en el sidebar entre Inventario y Categorías.

- [ ] **Step 6: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: ambos sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(dashboard\)/productos/page.tsx src/components/products/CatalogFilters.tsx src/components/products/CatalogTable.tsx src/components/layout/nav-config.tsx
git commit -m "feat(productos): listado de catalogo con filtros y paginacion"
```

---

### Task 5: Escritura masiva con aislamiento de fallos

**Files:**
- Create: `src/lib/products/odoo-catalog-write.ts`
- Test: `src/lib/products/odoo-catalog-write.test.ts`

**Interfaces:**
- Consumes: `assertWritable`, `assertModelAllowed`, `toOdooValues` (Task 1); `TemplatePatch`, `BulkResult` (Task 1); `odooRpc.executeKw` de `@/lib/odoo`; `translateOdooError` de `@/lib/odoo-write`.
- Produces: `updateTemplates(ids: number[], patch: TemplatePatch): Promise<BulkResult>`

Comportamiento clave: se escribe en lotes de 50. Si un lote falla, se reintenta **producto por producto** para aislar cuál lo causó — así el resumen puede nombrar al culpable en vez de reportar 50 fallos.

- [ ] **Step 1: Escribir la prueba que falla**

`src/lib/products/odoo-catalog-write.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const { executeKw } = vi.hoisted(() => ({ executeKw: vi.fn() }));
vi.mock("@/lib/odoo", () => ({ odooRpc: { executeKw, searchRead: vi.fn() } }));
vi.mock("@/lib/odoo-write", () => ({ translateOdooError: (e: unknown) => String(e) }));

import { updateTemplates } from "./odoo-catalog-write";

beforeEach(() => executeKw.mockReset());

describe("updateTemplates", () => {
  it("no llama a Odoo si no hay ids", async () => {
    const r = await updateTemplates([], { isPublished: true });
    expect(r).toEqual({ ok: [], failed: [] });
    expect(executeKw).not.toHaveBeenCalled();
  });

  it("rechaza un patch vacio antes de salir a la red", async () => {
    await expect(updateTemplates([1], {})).rejects.toThrow(/sin cambios/i);
    expect(executeKw).not.toHaveBeenCalled();
  });

  it("escribe en lotes de 50", async () => {
    executeKw.mockResolvedValue(true);
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    const r = await updateTemplates(ids, { categoryId: 3 });
    expect(executeKw).toHaveBeenCalledTimes(3);
    expect(r.ok).toHaveLength(120);
    expect(r.failed).toEqual([]);
  });

  it("manda el modelo y los valores traducidos", async () => {
    executeKw.mockResolvedValue(true);
    await updateTemplates([7], { categoryId: 3 });
    const [modelo, metodo, args] = executeKw.mock.calls[0];
    expect(modelo).toBe("product.template");
    expect(metodo).toBe("write");
    expect(args).toEqual([[7], { categ_id: 3 }]);
  });

  it("aisla al culpable reintentando uno por uno cuando el lote falla", async () => {
    // 1a llamada: el lote de 3 falla. Luego uno por uno: 1 ok, 2 falla, 3 ok.
    executeKw
      .mockRejectedValueOnce(new Error("lote invalido"))
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("producto archivado"))
      .mockResolvedValueOnce(true);

    const r = await updateTemplates([1, 2, 3], { isPublished: true });
    expect(r.ok).toEqual([1, 3]);
    expect(r.failed).toEqual([{ id: 2, error: "Error: producto archivado" }]);
    expect(executeKw).toHaveBeenCalledTimes(4);
  });

  it("nunca deja pasar un campo de inventario", async () => {
    executeKw.mockResolvedValue(true);
    // @ts-expect-error se fuerza un patch invalido a proposito
    await expect(updateTemplates([1], { qty_available: 5 })).rejects.toThrow(/sin cambios/i);
  });
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npm test -- odoo-catalog-write`
Expected: FAIL — `Failed to resolve import "./odoo-catalog-write"`.

- [ ] **Step 3: Escribir el módulo**

`src/lib/products/odoo-catalog-write.ts`:

```ts
import { odooRpc } from "@/lib/odoo";
import { translateOdooError } from "@/lib/odoo-write";
import { assertModelAllowed, assertWritable, toOdooValues } from "./write-guard";
import type { BulkResult, TemplatePatch } from "./types";

/**
 * Escritura de catalogo hacia Odoo. Hermano de src/lib/odoo-write.ts y con el
 * mismo contrato:
 *  - Solo se invoca desde server actions disparadas por un clic del usuario.
 *    Ningun sync, cron o route handler la importa.
 *  - Solo escribe atributos de catalogo. La lista blanca de write-guard.ts
 *    garantiza que no pueda tocar inventario.
 */

const MODEL = "product.template";

/** Mismo tope que odoo-write.ts: el cliente compartido no acota por defecto. */
const ODOO_WRITE_TIMEOUT_MS = 60_000;

/**
 * Tamaño de lote. 50 mantiene el payload chico y el tiempo por llamada bien
 * debajo del timeout, incluso con los recalculos que Odoo dispara al cambiar
 * categoria en productos con historial.
 */
const BATCH_SIZE = 50;

export async function updateTemplates(ids: number[], patch: TemplatePatch): Promise<BulkResult> {
  if (ids.length === 0) return { ok: [], failed: [] };

  assertModelAllowed(MODEL);
  const values = toOdooValues(patch);
  if (Object.keys(values).length === 0) {
    throw new Error("El cambio masivo no trae ningun campo: patch sin cambios");
  }
  assertWritable(values);

  const result: BulkResult = { ok: [], failed: [] };

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const lote = ids.slice(i, i + BATCH_SIZE);
    try {
      await write(lote, values);
      result.ok.push(...lote);
    } catch {
      // El lote fallo pero Odoo no dice por cual producto. Se reintenta uno a
      // uno para poder nombrar al culpable: reportar 50 fallos cuando solo uno
      // esta archivado le haria perder el cambio a los otros 49.
      for (const id of lote) {
        try {
          await write([id], values);
          result.ok.push(id);
        } catch (err) {
          result.failed.push({ id, error: translateOdooError(err) });
        }
      }
    }
  }

  return result;
}

function write(ids: number[], values: Record<string, unknown>): Promise<boolean> {
  return odooRpc.executeKw<boolean>(MODEL, "write", [ids, values], {}, ODOO_WRITE_TIMEOUT_MS);
}
```

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `npm test`
Expected: PASS — todas, incluidas las 6 nuevas.

- [ ] **Step 5: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: ambos sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/products/odoo-catalog-write.ts src/lib/products/odoo-catalog-write.test.ts
git commit -m "feat(productos): escritura masiva por lotes con aislamiento de fallos"
```

---

### Task 6: Acciones masivas end-to-end

**Files:**
- Create: `src/app/(dashboard)/productos/actions.ts`
- Create: `src/components/products/BulkActionBar.tsx`
- Create: `src/components/products/BulkActionDialog.tsx`
- Create: `src/components/products/CatalogWorkspace.tsx`
- Modify: `src/components/products/CatalogTable.tsx`
- Modify: `src/app/(dashboard)/productos/page.tsx`

**Interfaces:**
- Consumes: `updateTemplates` (Task 5); `CatalogRow`, `CatalogOptions`, `TemplatePatch` (Task 1); `auth` de `@/lib/auth`; patrón de `requireSession` de `src/app/(dashboard)/reabastecimiento/actions.ts:16-20`.
- Produces:
  - `applyBulkChange(input: unknown): Promise<{ ok: boolean; error?: string; okCount?: number; failed?: Array<{ id: number; error: string }> }>` — server action.
  - `<CatalogTable rows selected onToggle onToggleAll />`
  - `<BulkActionBar selectedIds rows options onDone />`

- [ ] **Step 1: Escribir la server action**

`src/app/(dashboard)/productos/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateTemplates } from "@/lib/products/odoo-catalog-write";
import type { TemplatePatch } from "@/lib/products/types";

// Un archivo "use server" solo puede exportar funciones async; el tipo queda interno.
type BulkActionResult = {
  ok: boolean;
  error?: string;
  okCount?: number;
  failed?: Array<{ id: number; error: string }>;
};

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("No autorizado");
  return session;
}

/**
 * El tope de 500 no es arbitrario: son 10 lotes de 50, que en el peor caso
 * (todos fallan y se reintentan uno a uno) son 510 llamadas RPC. Mas que eso
 * y la accion se pasaria del limite de tiempo de la funcion serverless.
 */
const bulkSchema = z
  .object({
    ids: z.array(z.number().int().positive()).min(1).max(500),
    categoryId: z.number().int().positive().optional(),
    publicCategoryIds: z.array(z.number().int().positive()).optional(),
    isPublished: z.boolean().optional(),
    purchaseTaxIds: z.array(z.number().int().positive()).optional(),
    supplierPartnerId: z.number().int().positive().optional(),
  })
  .refine(
    (v) =>
      v.categoryId !== undefined ||
      v.publicCategoryIds !== undefined ||
      v.isPublished !== undefined ||
      v.purchaseTaxIds !== undefined ||
      v.supplierPartnerId !== undefined,
    { message: "No se indico ningun cambio" }
  );

export async function applyBulkChange(input: unknown): Promise<BulkActionResult> {
  await requireSession();

  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos invalidos" };
  }

  const { ids, ...patch } = parsed.data;

  try {
    const result = await updateTemplates(ids, patch as TemplatePatch);
    revalidatePath("/productos");
    return { ok: true, okCount: result.ok.length, failed: result.failed };
  } catch (err) {
    console.error("[productos] fallo el cambio masivo:", err);
    return { ok: false, error: "No se pudo aplicar el cambio. Revisa la conexión con Odoo." };
  }
}
```

- [ ] **Step 2: Agregar selección múltiple a la tabla**

En `src/components/products/CatalogTable.tsx`, cambiar la firma del componente y agregar la columna de casillas.

Reemplazar la declaración del componente:

```tsx
export function CatalogTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
}: {
  rows: CatalogRow[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
}) {
  const todosMarcados = rows.length > 0 && rows.every((r) => selected.has(r.templateId));
```

Como primera columna del `<thead>`, antes de `Producto`:

```tsx
            <th className="py-2 px-3 w-8">
              <input
                type="checkbox"
                checked={todosMarcados}
                onChange={onToggleAll}
                aria-label="Seleccionar toda la página"
                className="h-3.5 w-3.5 accent-primary"
              />
            </th>
```

Como primera celda de cada `<tr>` del `<tbody>`:

```tsx
              <td className="py-2 px-3">
                <input
                  type="checkbox"
                  checked={selected.has(r.templateId)}
                  onChange={() => onToggle(r.templateId)}
                  aria-label={`Seleccionar ${r.name}`}
                  className="h-3.5 w-3.5 accent-primary"
                />
              </td>
```

- [ ] **Step 3: Crear el diálogo de confirmación**

`src/components/products/BulkActionDialog.tsx`:

```tsx
"use client";

import { AlertTriangle } from "lucide-react";
import type { CatalogOptions } from "@/lib/products/types";

export type BulkField = "categoria" | "categoriaWeb" | "publicar" | "impuesto" | "proveedor";

export const BULK_LABEL: Record<BulkField, string> = {
  categoria: "Categoría interna",
  categoriaWeb: "Categoría de ecommerce",
  publicar: "Publicación en web",
  impuesto: "Impuesto de compra",
  proveedor: "Proveedor",
};

export function BulkActionDialog({
  field,
  count,
  conProveedor,
  options,
  value,
  onValueChange,
  onCancel,
  onConfirm,
  pending,
}: {
  field: BulkField;
  count: number;
  /** Cuantos de los seleccionados ya tienen proveedor. Solo se usa en "proveedor". */
  conProveedor: number;
  options: CatalogOptions;
  value: string;
  onValueChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const lista =
    field === "categoria"
      ? options.categories
      : field === "categoriaWeb"
        ? options.publicCategories
        : field === "impuesto"
          ? options.purchaseTaxes
          : field === "proveedor"
            ? options.suppliers
            : [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-sm font-semibold">{BULK_LABEL[field]}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Se aplicará a {count} producto{count !== 1 ? "s" : ""}.
          </p>
        </div>

        {field === "publicar" ? (
          <select
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">Elegir…</option>
            <option value="1">Publicar en la tienda</option>
            <option value="0">Quitar de la tienda</option>
          </select>
        ) : (
          <select
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">Elegir…</option>
            {lista.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}

        {field === "proveedor" && conProveedor > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">
                {conProveedor} de los {count} seleccionados ya tienen proveedor.
              </span>{" "}
              El proveedor nuevo los reemplaza: se pierden los precios y plazos que tengan cargados
              en Odoo. Esto no se puede deshacer.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={!value || pending}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Aplicando…" : "Aplicar"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Crear la barra de acciones**

`src/components/products/BulkActionBar.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { applyBulkChange } from "@/app/(dashboard)/productos/actions";
import { BulkActionDialog, BULK_LABEL, type BulkField } from "./BulkActionDialog";
import type { CatalogOptions, CatalogRow } from "@/lib/products/types";

const CAMPOS: BulkField[] = ["categoria", "categoriaWeb", "publicar", "impuesto", "proveedor"];

export function BulkActionBar({
  selectedIds,
  rows,
  options,
  onDone,
}: {
  selectedIds: number[];
  rows: CatalogRow[];
  options: CatalogOptions;
  onDone: () => void;
}) {
  const router = useRouter();
  const [field, setField] = useState<BulkField | null>(null);
  const [value, setValue] = useState("");
  // `submitting` cubre la escritura misma; `pending` solo cubre el refresh.
  // Sin el primero, un doble clic en "Aplicar" dispararia DOS escrituras
  // masivas contra Odoo de produccion antes de que la primera termine.
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition] = useTransition();

  if (selectedIds.length === 0) return null;

  const seleccion = new Set(selectedIds);
  const conProveedor = rows.filter((r) => seleccion.has(r.templateId) && r.supplierName).length;

  function abrir(f: BulkField) {
    setField(f);
    setValue("");
  }

  async function confirmar() {
    if (!field || !value || submitting) return;
    const n = Number(value);

    const patch =
      field === "categoria"
        ? { categoryId: n }
        : field === "categoriaWeb"
          ? { publicCategoryIds: [n] }
          : field === "impuesto"
            ? { purchaseTaxIds: [n] }
            : field === "proveedor"
              ? { supplierPartnerId: n }
              : { isPublished: value === "1" };

    setSubmitting(true);
    let res;
    try {
      res = await applyBulkChange({ ids: selectedIds, ...patch });
    } finally {
      setSubmitting(false);
    }

    if (!res.ok) {
      toast.error(res.error ?? "No se pudo aplicar el cambio");
      return;
    }

    const fallidos = res.failed ?? [];
    if (fallidos.length === 0) {
      toast.success(`${res.okCount} producto${res.okCount === 1 ? "" : "s"} actualizado${res.okCount === 1 ? "" : "s"}`);
    } else {
      toast.warning(
        `${res.okCount} aplicados, ${fallidos.length} fallaron: ${fallidos
          .slice(0, 3)
          .map((f) => `#${f.id} ${f.error}`)
          .join(" · ")}${fallidos.length > 3 ? "…" : ""}`,
        { duration: 10_000 }
      );
    }

    setField(null);
    onDone();
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="sticky bottom-4 z-40 mx-auto flex w-fit items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lg flex-wrap justify-center">
        <span className="text-xs font-medium whitespace-nowrap">
          {selectedIds.length} seleccionado{selectedIds.length !== 1 ? "s" : ""}
        </span>
        <span className="h-4 w-px bg-border" />
        {CAMPOS.map((f) => (
          <button
            key={f}
            onClick={() => abrir(f)}
            className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-secondary whitespace-nowrap"
          >
            {BULK_LABEL[f]}
          </button>
        ))}
        <button onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground px-1">
          Limpiar
        </button>
      </div>

      {field && (
        <BulkActionDialog
          field={field}
          count={selectedIds.length}
          conProveedor={conProveedor}
          options={options}
          value={value}
          onValueChange={setValue}
          onCancel={() => setField(null)}
          onConfirm={confirmar}
          pending={submitting || pending}
        />
      )}
    </>
  );
}
```

- [ ] **Step 5: Conectar tabla y barra con un contenedor cliente**

La selección es estado de cliente compartido entre tabla y barra, así que necesitan un padre cliente común. Crear `src/components/products/CatalogWorkspace.tsx`:

```tsx
"use client";

import { useState } from "react";
import { CatalogTable } from "./CatalogTable";
import { BulkActionBar } from "./BulkActionBar";
import type { CatalogOptions, CatalogRow } from "@/lib/products/types";

export function CatalogWorkspace({
  rows,
  options,
}: {
  rows: CatalogRow[];
  options: CatalogOptions;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const todosMarcados = rows.length > 0 && rows.every((r) => prev.has(r.templateId));
      const next = new Set(prev);
      for (const r of rows) {
        if (todosMarcados) next.delete(r.templateId);
        else next.add(r.templateId);
      }
      return next;
    });
  }

  return (
    <>
      <CatalogTable rows={rows} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
      <BulkActionBar
        selectedIds={[...selected]}
        rows={rows}
        options={options}
        onDone={() => setSelected(new Set())}
      />
    </>
  );
}
```

En `src/app/(dashboard)/productos/page.tsx`, reemplazar el import y el uso de `CatalogTable` por `CatalogWorkspace`:

```tsx
import { CatalogWorkspace } from "@/components/products/CatalogWorkspace";
```

```tsx
      <CatalogWorkspace rows={data.rows} options={options} />
```

- [ ] **Step 6: Verificar en el navegador con datos reales**

1. Marcar 3 productos y comprobar que la barra aparece con "3 seleccionados".
2. "Categoría interna" → elegir una → Aplicar. Toast de éxito, la tabla se refresca y la columna Categoría cambia en los tres.
3. Abrir esos productos en Odoo y confirmar la categoría nueva.
4. Filtrar por "Sin proveedor", marcar 2, abrir "Proveedor": **no debe aparecer el aviso ámbar** (ninguno tiene proveedor).
5. Quitar el filtro, marcar productos que sí tengan proveedor y abrir "Proveedor": el aviso debe decir el número correcto.
6. "Publicación en web" → "Quitar de la tienda" sobre 1 producto; el badge pasa a "Oculto". Volver a publicarlo.

- [ ] **Step 7: Verificar lint y build**

Run: `npm test && npm run lint && npm run build`
Expected: los tres sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(dashboard\)/productos/actions.ts src/app/\(dashboard\)/productos/page.tsx src/components/products/BulkActionBar.tsx src/components/products/BulkActionDialog.tsx src/components/products/CatalogTable.tsx src/components/products/CatalogWorkspace.tsx
git commit -m "feat(productos): acciones masivas de categoria proveedor y publicacion"
```

---

### Task 7: Verificación de la barrera contra el Odoo real

La prueba unitaria demuestra que la barrera rechaza los campos prohibidos. Esta tarea demuestra que **el módulo entero, corriendo de verdad, no movió inventario**. Es la que cierra el compromiso con el dueño.

**Files:**
- Create: `scripts/verify-inventario.ts` (queda en el repo)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: evidencia, no código.

- [ ] **Step 1: Tomar la foto del inventario ANTES**

El script se queda en el repo: es la comprobacion de la promesa central del modulo y hay que poder repetirla cada vez que se toque la capa de escritura, no solo hoy.

Crear `scripts/verify-inventario.ts`:

```ts
/* Compara qty_available antes y despues de una tanda de cambios masivos y
   cuenta los movimientos de stock del dia. Solo lectura contra Odoo.
   Uso: npm run verify:inventario antes  ...aplicar cambios...  npm run verify:inventario despues */
import { odooRpc } from "../src/lib/odoo";
import fs from "node:fs";

const SNAPSHOT = "/tmp/utilia-inventario.json";

(async () => {
  const modo = process.argv[2]; // "antes" | "despues"

  const productos = await odooRpc.searchRead<{ id: number; name: string; qty_available: number }>(
    "product.template",
    [],
    ["id", "name", "qty_available"],
    { limit: 2000, order: "id asc" }
  );
  const mapa = Object.fromEntries(productos.map((p) => [p.id, p.qty_available]));

  const hoy = new Date().toISOString().slice(0, 10);
  const movimientos = await odooRpc.executeKw<number>("stock.move", "search_count", [
    [["date", ">=", `${hoy} 00:00:00`]],
  ]);

  if (modo === "antes") {
    fs.writeFileSync(SNAPSHOT, JSON.stringify({ mapa, movimientos }));
    console.log(`Foto guardada: ${productos.length} productos, ${movimientos} movimientos hoy.`);
    return;
  }

  const previo = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const cambios = productos.filter((p) => previo.mapa[p.id] !== undefined && previo.mapa[p.id] !== p.qty_available);

  console.log(`Movimientos de stock hoy: antes ${previo.movimientos} → ahora ${movimientos}`);
  if (cambios.length === 0) {
    console.log("OK: ninguna cantidad cambio.");
  } else {
    console.log(`FALLO: ${cambios.length} productos cambiaron de cantidad:`);
    cambios.slice(0, 20).forEach((p) => console.log(`   ${p.id} ${p.name}: ${previo.mapa[p.id]} → ${p.qty_available}`));
  }
})();
```

Registrarlo en `package.json` junto a los otros scripts de diagnostico:

```json
    "verify:inventario": "tsx --env-file=.env.local scripts/verify-inventario.ts",
```

Run: `npm run verify:inventario antes`
Expected: `Foto guardada: 1574 productos, N movimientos hoy.`

- [ ] **Step 2: Ejercitar todas las acciones masivas**

En `/productos`, sobre **al menos 20 productos seleccionados**, aplicar una tras otra: categoría interna, categoría de ecommerce, publicar, quitar de la tienda, impuesto de compra y proveedor. Anotar los totales que reporte cada toast.

- [ ] **Step 3: Comparar contra la foto**

Run: `npm run verify:inventario despues`

Expected:
- `OK: ninguna cantidad cambio.`
- El conteo de movimientos de stock del día debe ser **idéntico** al de la foto.

Si alguna cantidad cambió o aparecieron movimientos nuevos, es un fallo bloqueante: hay que encontrar por dónde se escapó la escritura antes de seguir. La causa más probable sería un campo agregado a `WRITABLE_FIELDS` sin pensarlo.

- [ ] **Step 4: Limpiar solo la foto, no el script**

La foto es un archivo temporal de una corrida concreta; el script se queda.

```bash
rm /tmp/utilia-inventario.json
```

- [ ] **Step 5: Confirmar que no se filtró ningún secreto**

Run: `grep -nE "ODOO_|SUPABASE|DATABASE_URL|sk-|api_key" scripts/verify-inventario.ts; git status --short`
Expected: el grep no encuentra nada, y `.env.local` no aparece en el estado.

- [ ] **Step 6: Documentar el resultado en el spec**

Al final de `docs/superpowers/specs/2026-09-04-modulo-productos-design.md`, agregar:

```markdown
## Verificación de la barrera (Fase 1)

Ejecutada el <fecha>, tras aplicar las cinco acciones masivas sobre <N> productos:
`qty_available` sin cambios en las 1.574 plantillas, y cero movimientos de
`stock.move` nuevos. La barrera se comporta como está diseñada.
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-09-04-modulo-productos-design.md scripts/verify-inventario.ts package.json
git commit -m "docs(productos): registro de la verificacion de la barrera de inventario"
```

---

## Fuera de este plan

**Fase 2 — Carga masiva** (`ProductImportBatch`, hoja editable, importación de CSV, imágenes, creación en Odoo, pendientes de inventario) va en su propio plan, `docs/superpowers/plans/YYYY-MM-DD-modulo-productos-fase2.md`, una vez que Fase 1 esté andando en producción. Cuando se escriba, hay que agregar a `WRITABLE_FIELDS` los campos que `createTemplate` necesita y que hoy no están: `name`, `type`, `is_storable`, `list_price`, `image_1920`, `show_availability` y `standard_price` — todos seguros solo en la creación, donde el stock es 0. Van en el mismo cambio que introduce `createTemplate`, nunca antes.
