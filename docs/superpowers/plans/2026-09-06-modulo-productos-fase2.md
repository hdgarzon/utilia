# Módulo de Productos — Fase 2 (Carga masiva) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una pantalla `/productos/cargar` donde se pega una lista de productos desde Excel (o se importa un CSV), se corrige lo que la hoja marque en rojo, y se crean todos en Odoo de una vez — sin que Utilia toque inventario.

**Architecture:** Una hoja editable en el cliente cuyo estado se persiste como borrador (`ProductImportBatch` + `ProductImportRow`) para poder salir y volver. La validación es una función pura que devuelve errores **por celda** contra los catálogos vivos de Odoo. La creación corre por **tandas** desde el cliente: cada invocación crea unas cuantas filas y devuelve el progreso, lo que da barra de progreso, resistencia al límite de tiempo serverless y reanudación gratis. La barrera de escritura se parte en dos: campos seguros al **crear** (producto en cero) y campos seguros al **actualizar**.

**Tech Stack:** Next.js 16 App Router (React 19, server components + server actions), TypeScript, Prisma/Postgres, Tailwind 4, Zod 4, vitest, Odoo 19 JSON-RPC.

**Spec:** `docs/superpowers/specs/2026-09-04-modulo-productos-design.md`
**Fase 1 (ya en `main`):** `docs/superpowers/plans/2026-09-04-modulo-productos-fase1.md`

## Global Constraints

- **Utilia nunca genera movimientos de inventario.** Ni escribe `qty_available`, `inventory_quantity` o `free_qty`, ni toca los modelos `stock.quant`, `stock.move`, `stock.inventory`. Crear un producto **no** mueve inventario porque nace en cero; poner una cantidad sí lo movería, y por eso `qtyOnHand` se captura pero **jamás se escribe**.
- **`standard_price` y `list_price` solo se escriben al CREAR.** Sobre un producto con stock, el costo dispara una revalorización contable. Esto deja de ser una convención y pasa a ser código: la barrera se parte en `assertWritableOnCreate` y `assertWritableOnUpdate` (Task 4).
- Toda escritura a Odoo se invoca **solo desde server actions disparadas por un clic**. Ningún sync, cron ni route handler importa el módulo de escritura.
- **La creación es secuencial**, nunca en paralelo. Odoo.sh estrangula la concurrencia con HTTP 429 a partir de ~5 peticiones simultáneas (medido en Fase 1); el semáforo de `src/lib/odoo.ts` acota a 3, pero el orden importa para que los resultados se correspondan con las filas.
- Textos de UI en **español con tildes**; comentarios de código en **español sin tildes**.
- Commits en **español sin tildes**, formato `scope(area): resumen`.
- **Sin atribución de IA** en commits, ramas, PRs ni comentarios (regla de `CLAUDE.md`).
- **Nunca `git add -A` ni `git add .`** — rutas explícitas.
- **Nunca commitear `.env.local`, secretos ni datos de producción.**
- La salida de `npm test` debe quedar limpia: ninguna línea que empiece por `(!)`. Hoy pasan 33 pruebas.
- El repo **no usa carpeta de migraciones**. `npm run db:push` está **roto** sobre esta base por tablas ajenas con llaves foráneas al esquema `auth` de Supabase; los cambios de esquema de este plan se aplican con SQL explícito (ver Task 1).

## Lo que Fase 1 ya dejó (no recrear)

- `src/lib/products/types.ts` — `ProductType`, `CatalogFilters`, `CatalogRow`, `CatalogOptions`, `TemplatePatch`, `BulkResult`.
- `src/lib/products/write-guard.ts` — `WRITABLE_FIELDS` (5 campos), `assertWritable`, `assertModelAllowed`, `toOdooValues`.
- `src/lib/products/catalog.ts` — `listTemplates`, `getCatalogOptions`, `PAGE_SIZE`.
- `src/lib/products/odoo-catalog-write.ts` — `updateTemplates`, `ODOO_WRITE_TIMEOUT_MS`, el corte ante fallo de transporte.
- `src/lib/odoo.ts` — cliente con deduplicación de autenticación y semáforo de concurrencia (3).
- `src/lib/odoo-write.ts` — `translateOdooError(err, context?)` con contexto `"compras" | "catalogo"`.
- `src/lib/csv.ts` — `buildCsv`, `downloadCsv`, `escapeCsvCell`.
- `src/lib/timezone.ts` — `colombiaToday`, `colombiaDayString`.
- `scripts/verify-inventario.ts` — verificador de ajustes de inventario (`npm run verify:inventario antes|despues`).

## Hechos verificados del Odoo (2026-09-06)

Consultados en modo lectura contra producción:

- `product.template.create`, `product.supplierinfo.create` y `product.category.create`: **permitidos**.
- Solo `name` y `type` son **obligatorios** al crear. Todo lo demás es opcional — una fila incompleta no rompe la creación, se crea con lo que tenga.
- `uom_id` no es obligatorio: Odoo asigna Unidades por defecto.
- `standard_price` es escribible (campo de propiedad por compañía, `store: false`).

## File Structure

**Crear:**

| Archivo | Responsabilidad |
|---|---|
| `src/lib/products/import-types.ts` | Tipos, topes y `filaVacia`. Sin I/O |
| `src/lib/products/import-schema.ts` | `validateRow`: validación **por celda**. Puro, sin imports de I/O |
| `src/lib/products/import-schema.test.ts` | |
| `src/lib/products/csv-import.ts` | Parseo de CSV/TSV y mapeo de columnas. Puro |
| `src/lib/products/csv-import.test.ts` | |
| `src/lib/products/image-resize.ts` | Reducción de imagen en el navegador (canvas). Solo cliente |
| `src/app/(dashboard)/productos/cargar/page.tsx` | Pantalla de la hoja |
| `src/app/(dashboard)/productos/cargar/actions.ts` | Server actions: guardar borrador, crear tanda |
| `src/components/products/ImportSheet.tsx` | La hoja: estado del lote, pegar desde Excel |
| `src/components/products/ImportSheetRow.tsx` | Una fila, con sus errores por celda |
| `src/components/products/ImageCell.tsx` | Celda de imagen: link o archivo |
| `src/components/products/ImportToolbar.tsx` | Importar CSV, plantilla, crear en Odoo |
| `src/components/products/ImportResult.tsx` | Resumen, reintento y pendientes de inventario |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | `ProductImportBatch`, `ProductImportRow` y sus enums |
| `src/lib/products/write-guard.ts` | Partir la barrera en crear/actualizar; `toOdooCreateValues` |
| `src/lib/products/write-guard.test.ts` | Fijar ambas listas; probar que el costo se rechaza al actualizar |
| `src/lib/products/odoo-catalog-write.ts` | `createTemplate`; renombrar la llamada a `assertWritableOnUpdate` |
| `src/lib/products/odoo-catalog-write.test.ts` | Pruebas de `createTemplate` |
| `src/app/(dashboard)/productos/page.tsx` | Botón "Cargar productos" hacia `/productos/cargar` |

`import-schema.ts` y `csv-import.ts` se mantienen **sin imports de I/O** a propósito: son la lógica que hay que poder probar sin Odoo, Prisma ni navegador.

---

### Task 1: Modelo de datos del borrador

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/products/import-types.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - Modelos Prisma `ProductImportBatch`, `ProductImportRow`; enums `ProductImportStatus`, `ProductImportRowStatus`.
  - `ImportRowInput`, `ImportRowDraft`, `CellError`, `ImportProgress` (tipos, en `import-types.ts`).

- [ ] **Step 1: Agregar los modelos al esquema**

Al final de `prisma/schema.prisma`, siguiendo el estilo de los bloques existentes (encabezado con `─`):

```prisma
// ─── Carga masiva de productos ────────────────────────────────────────────────

model ProductImportBatch {
  id        String              @id @default(cuid())
  name      String // "Lista Distribuidora X - sep"
  status    ProductImportStatus @default(DRAFT)
  createdBy String? // User.id de quien lo creo
  rows      ProductImportRow[]
  createdAt DateTime            @default(now())
  updatedAt DateTime            @updatedAt

  @@index([status])
}

enum ProductImportStatus {
  DRAFT // en edicion
  CREATING // creacion en curso (una tanda corriendo)
  DONE // todas las filas OK
  PARTIAL // al menos una fila con error, reintentable
}

model ProductImportRow {
  id       String             @id @default(cuid())
  batch    ProductImportBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  batchId  String
  rowIndex Int // orden en la hoja

  // Campos del producto
  name           String
  productType    String  @default("consu") // "consu" | "service" | "combo"
  isStorable     Boolean @default(true) // rastreo de inventario
  // Capturado para exportarlo como pendiente. NUNCA se escribe en Odoo:
  // ponerle cantidad a un producto exige un ajuste de inventario.
  qtyOnHand      Float?
  salePrice      Float?
  cost           Float?
  purchaseTaxIds Int[] // account.tax
  categoryId     Int? // product.category
  imageUrl       String? // link, se descarga al crear
  imageData      String? @db.Text // base64 ya reducido en el navegador

  // Tienda
  isPublished       Boolean @default(false)
  publicCategoryIds Int[] // product.public.category
  showAvailability  Boolean @default(false)

  // Proveedor
  supplierPartnerId Int? // res.partner

  // Resultado
  status         ProductImportRowStatus @default(PENDING)
  odooTemplateId Int?
  error          String?
  // Se creo bien pero algo secundario fallo (p. ej. la imagen no se pudo
  // descargar). La fila queda OK: una imagen rota no debe costar el producto.
  warning        String?

  @@unique([batchId, rowIndex])
  @@index([batchId])
}

enum ProductImportRowStatus {
  PENDING
  OK
  ERROR
}
```

- [ ] **Step 2: Aplicar las tablas y regenerar el cliente**

**No uses `npm run db:push`.** Falla con `P4002` sobre esta base y no por culpa de este cambio: la base de Utilia arrastra cinco tablas vacías de otra aplicación (`profiles`, `accreditation_requests`, `competitions`, `competition_entries`, `email_logs`) con llaves foráneas hacia el esquema `auth` de Supabase, que Prisma no puede introspeccionar sin `multiSchema`. Decisión del dueño: no tocar esas tablas y aplicar las nuevas con SQL explícito.

El controlador ya aplicó esta migración a producción antes de despacharte. Tu trabajo aquí es **verificar** que quedó bien, no volver a aplicarla:

Run: `npx tsx --env-file=.env.local -e "import('./src/lib/prisma').then(async ({prisma}) => { console.log('lotes:', await prisma.productImportBatch.count()); console.log('filas:', await prisma.productImportRow.count()); await prisma.\$disconnect(); })"`

Expected: `lotes: 0` y `filas: 0` — las tablas existen, están vacías y el cliente de Prisma las alcanza. Si falla con "table does not exist", para y reporta BLOCKED.

Luego regenerar el cliente para que los tipos existan:

Run: `npm run db:generate`
Expected: termina sin errores.

**Las dos tablas nuevas nacen con RLS activado.** Prisma se conecta con el rol dueño de las tablas, que salta RLS, así que la app funciona igual; lo que queda cerrado es el acceso con la clave anónima, que esta app nunca usa para estos datos. Siete tablas más viejas siguen sin RLS — es un pendiente aparte, anotado, que no toca esta tarea.

- [ ] **Step 3: Crear los tipos compartidos**

`src/lib/products/import-types.ts`:

```ts
import type { ProductType } from "./types";

/** Una fila tal como la edita el usuario en la hoja, antes de validar. */
export interface ImportRowInput {
  /**
   * Identidad estable de la fila mientras se edita. Existe solo para la key
   * de React: usar el indice rompe el estado interno de las celdas (la de
   * imagen tiene el suyo) en cuanto se borra una fila del medio.
   */
  clientId: string;
  rowIndex: number;
  name: string;
  productType: ProductType;
  isStorable: boolean;
  /** Se captura y se exporta como pendiente; nunca se escribe en Odoo. */
  qtyOnHand: number | null;
  salePrice: number | null;
  cost: number | null;
  purchaseTaxIds: number[];
  categoryId: number | null;
  imageUrl: string | null;
  imageData: string | null;
  isPublished: boolean;
  publicCategoryIds: number[];
  showAvailability: boolean;
  supplierPartnerId: number | null;
}

/**
 * Lo que necesita la creacion en Odoo: la fila sin nada del navegador.
 * `clientId` solo sirve para la key de React y `rowIndex` para el orden en la
 * hoja; ninguno significa nada para Odoo.
 */
export type ProductCreateInput = Omit<ImportRowInput, "clientId" | "rowIndex">;

/** Una fila guardada, con su resultado. */
export interface ImportRowDraft extends ImportRowInput {
  /** Id en Postgres. Distinto de `clientId`, que solo vive en el navegador. */
  id: string;
  status: "PENDING" | "OK" | "ERROR";
  odooTemplateId: number | null;
  error: string | null;
  warning: string | null;
}

/**
 * Un problema en UNA celda. La hoja los agrupa por `field` para pintar de
 * rojo la celda exacta en vez de la fila entera.
 */
export interface CellError {
  field: keyof ImportRowInput;
  message: string;
  /** Una advertencia no impide crear; un error si. */
  level: "error" | "warning";
}

/** Lo que devuelve cada tanda de creacion, para mover la barra de progreso. */
export interface ImportProgress {
  processed: number;
  okCount: number;
  errorCount: number;
  remaining: number;
  done: boolean;
}

/**
 * Constructor de una fila en blanco.
 *
 * Vive aqui y no en `ImportSheet` porque `ImportToolbar` tambien la necesita:
 * si la exportara el componente, los dos se importarian mutuamente.
 */
export function filaVacia(rowIndex: number): ImportRowInput {
  return {
    // Identidad estable para la key de React. No viaja al servidor: el schema
    // de Zod de `saveBatch` no lo declara y Zod descarta lo que no conoce.
    clientId: crypto.randomUUID(),
    rowIndex,
    name: "",
    productType: "consu",
    isStorable: true,
    qtyOnHand: null,
    salePrice: null,
    cost: null,
    purchaseTaxIds: [],
    categoryId: null,
    imageUrl: null,
    imageData: null,
    isPublished: false,
    publicCategoryIds: [],
    showAvailability: false,
    supplierPartnerId: null,
  };
}

/** Topes duros, citados por la UI y por las server actions. */
export const MAX_ROWS_PER_BATCH = 200;
/** Base64 de la imagen ya reducida. ~500 KB. */
export const MAX_IMAGE_BASE64_BYTES = 500_000;
/** Filas que crea cada invocacion, para no pasarse del limite serverless. */
export const CREATE_SLICE_SIZE = 20;
```

- [ ] **Step 4: Verificar que compila**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: 33 pruebas pasando, lint sin errores (queda el warning preexistente de `financiero/page.tsx`), tipos limpios.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/lib/products/import-types.ts
git commit -m "feat(productos): modelo de borrador para la carga masiva"
```

---

### Task 2: Validación por celda

**Files:**
- Create: `src/lib/products/import-schema.ts`
- Test: `src/lib/products/import-schema.test.ts`

**Interfaces:**
- Consumes: `ImportRowInput`, `CellError` (Task 1); `CatalogOptions` de `./types`.
- Produces:
  - `validateRow(row: ImportRowInput, options: CatalogOptions): CellError[]`
  - `rowIsCreatable(errors: CellError[]): boolean`

Contexto: `CatalogOptions` es `{ categories, publicCategories, purchaseTaxes, suppliers }`, cada una `Array<{ id: number; name: string }>`.

- [ ] **Step 1: Escribir la prueba que falla**

`src/lib/products/import-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateRow, rowIsCreatable } from "./import-schema";
import type { ImportRowInput } from "./import-types";
import type { CatalogOptions } from "./types";

const OPCIONES: CatalogOptions = {
  categories: [{ id: 1, name: "PAPELERIA" }],
  publicCategories: [{ id: 10, name: "PAPELERIA WEB" }],
  purchaseTaxes: [{ id: 20, name: "19% VAT" }],
  suppliers: [{ id: 30, name: "Distribuidora Demo" }],
};

function fila(over: Partial<ProductCreateInput> = {}): ProductCreateInput {
  return {
    name: "CUADERNO DEMO",
    productType: "consu",
    isStorable: true,
    qtyOnHand: null,
    salePrice: 1000,
    cost: 600,
    purchaseTaxIds: [],
    categoryId: null,
    imageUrl: null,
    imageData: null,
    isPublished: false,
    publicCategoryIds: [],
    showAvailability: false,
    supplierPartnerId: null,
    ...over,
  };
}

const campos = (e: ReturnType<typeof validateRow>) => e.map((x) => x.field);

describe("validateRow", () => {
  it("una fila minima valida no produce nada", () => {
    expect(validateRow(fila(), OPCIONES)).toEqual([]);
  });

  it("exige nombre no vacio", () => {
    expect(campos(validateRow(fila({ name: "" }), OPCIONES))).toContain("name");
    expect(campos(validateRow(fila({ name: "   " }), OPCIONES))).toContain("name");
  });

  it("rechaza un tipo de producto desconocido", () => {
    // @ts-expect-error se fuerza un tipo invalido a proposito
    expect(campos(validateRow(fila({ productType: "kit" }), OPCIONES))).toContain("productType");
  });

  it("un servicio no puede llevar rastreo de inventario", () => {
    const e = validateRow(fila({ productType: "service", isStorable: true }), OPCIONES);
    expect(campos(e)).toContain("isStorable");
  });

  it("un combo tampoco puede llevar rastreo de inventario", () => {
    const e = validateRow(fila({ productType: "combo", isStorable: true }), OPCIONES);
    expect(campos(e)).toContain("isStorable");
  });

  it("un servicio sin rastreo es valido", () => {
    expect(validateRow(fila({ productType: "service", isStorable: false }), OPCIONES)).toEqual([]);
  });

  it("un servicio no puede llevar cantidad a la mano", () => {
    const e = validateRow(fila({ productType: "service", isStorable: false, qtyOnHand: 5 }), OPCIONES);
    expect(campos(e)).toContain("qtyOnHand");
  });

  it("rechaza precios negativos", () => {
    expect(campos(validateRow(fila({ salePrice: -1 }), OPCIONES))).toContain("salePrice");
    expect(campos(validateRow(fila({ cost: -1 }), OPCIONES))).toContain("cost");
  });

  it("acepta precio y costo en cero", () => {
    expect(validateRow(fila({ salePrice: 0, cost: 0 }), OPCIONES)).toEqual([]);
  });

  it("rechaza cantidad negativa", () => {
    expect(campos(validateRow(fila({ qtyOnHand: -3 }), OPCIONES))).toContain("qtyOnHand");
  });

  it("la categoria debe existir en el catalogo", () => {
    expect(validateRow(fila({ categoryId: 1 }), OPCIONES)).toEqual([]);
    expect(campos(validateRow(fila({ categoryId: 999 }), OPCIONES))).toContain("categoryId");
  });

  it("el impuesto de compra debe existir", () => {
    expect(validateRow(fila({ purchaseTaxIds: [20] }), OPCIONES)).toEqual([]);
    expect(campos(validateRow(fila({ purchaseTaxIds: [999] }), OPCIONES))).toContain("purchaseTaxIds");
  });

  it("la categoria web debe existir", () => {
    expect(campos(validateRow(fila({ publicCategoryIds: [999] }), OPCIONES))).toContain("publicCategoryIds");
  });

  it("el proveedor debe existir", () => {
    expect(campos(validateRow(fila({ supplierPartnerId: 999 }), OPCIONES))).toContain("supplierPartnerId");
  });

  it("la imagen por link debe ser http o https", () => {
    expect(validateRow(fila({ imageUrl: "https://x.co/a.jpg" }), OPCIONES)).toEqual([]);
    expect(campos(validateRow(fila({ imageUrl: "ftp://x.co/a.jpg" }), OPCIONES))).toContain("imageUrl");
    expect(campos(validateRow(fila({ imageUrl: "no soy una url" }), OPCIONES))).toContain("imageUrl");
  });

  it("publicar sin categoria web es advertencia, no error", () => {
    const e = validateRow(fila({ isPublished: true }), OPCIONES);
    expect(e).toHaveLength(1);
    expect(e[0].field).toBe("publicCategoryIds");
    expect(e[0].level).toBe("warning");
  });

  it("publicar con categoria web no advierte nada", () => {
    expect(validateRow(fila({ isPublished: true, publicCategoryIds: [10] }), OPCIONES)).toEqual([]);
  });
});

describe("rowIsCreatable", () => {
  it("una fila sin problemas se puede crear", () => {
    expect(rowIsCreatable([])).toBe(true);
  });

  it("una fila con solo advertencias se puede crear", () => {
    expect(rowIsCreatable([{ field: "publicCategoryIds", message: "x", level: "warning" }])).toBe(true);
  });

  it("una fila con un error no se puede crear", () => {
    expect(rowIsCreatable([{ field: "name", message: "x", level: "error" }])).toBe(false);
  });
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npm test -- import-schema`
Expected: FAIL — `Failed to resolve import "./import-schema"`.

- [ ] **Step 3: Escribir la validación**

`src/lib/products/import-schema.ts`:

```ts
import type { CellError, ImportRowInput } from "./import-types";
import type { CatalogOptions, ProductType } from "./types";

const TIPOS_VALIDOS: ReadonlySet<string> = new Set<ProductType>(["consu", "service", "combo"]);

/**
 * Valida una fila contra los catalogos vivos de Odoo y devuelve un problema
 * POR CELDA, no por fila: la hoja necesita saber que celda pintar de rojo.
 *
 * Sin imports de I/O a proposito. Recibe `options` ya cargado para poder
 * probarse sin Odoo.
 */
export function validateRow(row: ImportRowInput, options: CatalogOptions): CellError[] {
  const errores: CellError[] = [];
  const error = (field: CellError["field"], message: string) =>
    errores.push({ field, message, level: "error" });
  const aviso = (field: CellError["field"], message: string) =>
    errores.push({ field, message, level: "warning" });

  if (!row.name.trim()) error("name", "El nombre es obligatorio");

  if (!TIPOS_VALIDOS.has(row.productType)) {
    error("productType", "Tipo inválido: usa Bienes, Servicio o Combo");
  }

  // Odoo solo admite rastreo de inventario en bienes.
  const esBien = row.productType === "consu";
  if (!esBien && row.isStorable) {
    error("isStorable", "Solo los productos de tipo Bienes pueden llevar rastreo de inventario");
  }
  if (!esBien && row.qtyOnHand !== null) {
    error("qtyOnHand", "Un servicio o combo no lleva cantidad a la mano");
  }

  if (row.salePrice !== null && row.salePrice < 0) error("salePrice", "El precio no puede ser negativo");
  if (row.cost !== null && row.cost < 0) error("cost", "El costo no puede ser negativo");
  if (row.qtyOnHand !== null && row.qtyOnHand < 0) {
    error("qtyOnHand", "La cantidad no puede ser negativa");
  }

  if (row.categoryId !== null && !existe(options.categories, row.categoryId)) {
    error("categoryId", "Esa categoría no existe en el catálogo de Odoo");
  }
  for (const id of row.purchaseTaxIds) {
    if (!existe(options.purchaseTaxes, id)) {
      error("purchaseTaxIds", "Uno de los impuestos de compra no existe en el catálogo de Odoo");
      break;
    }
  }
  for (const id of row.publicCategoryIds) {
    if (!existe(options.publicCategories, id)) {
      error("publicCategoryIds", "Una de las categorías de la tienda no existe en el catálogo de Odoo");
      break;
    }
  }
  if (row.supplierPartnerId !== null && !existe(options.suppliers, row.supplierPartnerId)) {
    error("supplierPartnerId", "Ese proveedor no existe en el catálogo de Odoo");
  }

  if (row.imageUrl !== null && row.imageUrl.trim() && !esHttpUrl(row.imageUrl)) {
    error("imageUrl", "El link de la imagen debe empezar por http:// o https://");
  }

  // Advertencia y no error: el producto se publica igual, solo que no
  // aparecera bajo ninguna categoria de la tienda.
  if (row.isPublished && row.publicCategoryIds.length === 0) {
    aviso("publicCategoryIds", "Se publicará sin categoría en la tienda");
  }

  return errores;
}

/** Las advertencias no impiden crear; los errores si. */
export function rowIsCreatable(errors: CellError[]): boolean {
  return !errors.some((e) => e.level === "error");
}

function existe(lista: Array<{ id: number }>, id: number): boolean {
  return lista.some((o) => o.id === id);
}

function esHttpUrl(valor: string): boolean {
  try {
    const u = new URL(valor.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `npm test`
Expected: PASS — las 33 anteriores más 20 nuevas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/products/import-schema.ts src/lib/products/import-schema.test.ts
git commit -m "feat(productos): validacion por celda de las filas de carga"
```

---

### Task 3: Parseo de CSV y TSV

**Files:**
- Create: `src/lib/products/csv-import.ts`
- Test: `src/lib/products/csv-import.test.ts`

**Interfaces:**
- Consumes: nada (puro).
- Produces:
  - `parseDelimited(text: string): string[][]`
  - `COLUMNAS_PLANTILLA: ReadonlyArray<{ key: string; label: string }>`
  - `guessColumnMapping(headers: string[]): Array<string | null>`

Contexto: pegar desde Excel/Sheets produce **TSV**; un archivo exportado produce **CSV**. El separador se detecta contando cuál aparece más en la primera línea. Las comillas dobles agrupan y `""` escapa una comilla, igual que en `src/lib/csv.ts`.

- [ ] **Step 1: Escribir la prueba que falla**

`src/lib/products/csv-import.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseDelimited, guessColumnMapping, COLUMNAS_PLANTILLA } from "./csv-import";

describe("parseDelimited", () => {
  it("texto vacio no da filas", () => {
    expect(parseDelimited("")).toEqual([]);
    expect(parseDelimited("   \n  ")).toEqual([]);
  });

  it("separa por comas", () => {
    expect(parseDelimited("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("detecta tabulaciones cuando hay mas que comas", () => {
    expect(parseDelimited("a\tb\tc\n1\t2\t3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("una coma dentro de comillas no separa", () => {
    expect(parseDelimited('nombre,precio\n"CUADERNO, GRANDE",1000')).toEqual([
      ["nombre", "precio"],
      ["CUADERNO, GRANDE", "1000"],
    ]);
  });

  it("dos comillas seguidas son una comilla literal", () => {
    expect(parseDelimited('a\n"dice ""hola"""')).toEqual([["a"], ['dice "hola"']]);
  });

  it("un salto de linea dentro de comillas no corta la fila", () => {
    expect(parseDelimited('a,b\n"linea1\nlinea2",x')).toEqual([
      ["a", "b"],
      ["linea1\nlinea2", "x"],
    ]);
  });

  it("acepta finales de linea de Windows", () => {
    expect(parseDelimited("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("recorta el BOM que Excel antepone", () => {
    expect(parseDelimited("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("conserva las celdas vacias para no correr las columnas", () => {
    expect(parseDelimited("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("una comilla sin cerrar falla en vez de tragarse el resto", () => {
    // Sin esto, todo lo que sigue a la comilla huerfana se apilaba en UNA
    // celda y las filas posteriores desaparecian sin aviso. Un nombre como
    // 24" monitor escrito a mano basta para provocarlo.
    expect(() => parseDelimited('a,b\n"sin cerrar,valor\nmas texto')).toThrow(/comilla sin cerrar/i);
  });

  it("una comilla correctamente cerrada no falla", () => {
    expect(parseDelimited('a\n"cerrada"')).toEqual([["a"], ["cerrada"]]);
  });

  it("ignora una linea final vacia", () => {
    expect(parseDelimited("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("guessColumnMapping", () => {
  it("reconoce los encabezados de la plantilla", () => {
    const headers = COLUMNAS_PLANTILLA.map((c) => c.label);
    expect(guessColumnMapping(headers)).toEqual(COLUMNAS_PLANTILLA.map((c) => c.key));
  });

  it("ignora mayusculas y espacios sobrantes", () => {
    expect(guessColumnMapping(["  NOMBRE  ", "Precio de Venta"])).toEqual(["name", "salePrice"]);
  });

  it("ignora las tildes", () => {
    // Con tildes de verdad: sin este caso, borrar el paso que las quita
    // dejaria pasar la prueba igual.
    expect(guessColumnMapping(["Categoría"])).toEqual(["category"]);
    expect(guessColumnMapping(["CATEGORÍA DE LA TIENDA"])).toEqual(["publicCategory"]);
  });

  it("deja en null lo que no reconoce", () => {
    expect(guessColumnMapping(["nombre", "columna rara"])).toEqual(["name", null]);
  });

  it("no asigna la misma columna dos veces", () => {
    expect(guessColumnMapping(["nombre", "nombre"])).toEqual(["name", null]);
  });
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npm test -- csv-import`
Expected: FAIL — `Failed to resolve import "./csv-import"`.

- [ ] **Step 3: Escribir el parseo**

`src/lib/products/csv-import.ts`:

```ts
/**
 * Parseo de la lista pegada o importada. Sin imports: se prueba sola.
 *
 * Pegar desde Excel o Google Sheets produce TSV; un archivo exportado
 * produce CSV. Se detecta cual mirando la primera linea.
 */

/** Columnas de la plantilla, en el orden en que salen en el CSV de ejemplo. */
export const COLUMNAS_PLANTILLA: ReadonlyArray<{ key: string; label: string }> = [
  { key: "name", label: "Nombre" },
  { key: "productType", label: "Tipo" },
  { key: "isStorable", label: "Rastreo de inventario" },
  { key: "qtyOnHand", label: "Cantidad a la mano" },
  { key: "salePrice", label: "Precio de venta" },
  { key: "cost", label: "Costo" },
  { key: "purchaseTax", label: "Impuesto de compra" },
  { key: "category", label: "Categoria" },
  { key: "imageUrl", label: "Imagen (link)" },
  { key: "isPublished", label: "Publicado" },
  { key: "publicCategory", label: "Categoria de la tienda" },
  { key: "showAvailability", label: "Mostrar disponibilidad" },
  { key: "supplier", label: "Proveedor" },
];

export function parseDelimited(text: string): string[][] {
  const limpio = text.replace(/^﻿/, "");
  if (!limpio.trim()) return [];

  const sep = detectarSeparador(limpio);
  const filas: string[][] = [];
  let celda = "";
  let fila: string[] = [];
  let enComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];

    if (enComillas) {
      if (c === '"') {
        // Dos comillas seguidas son una comilla literal.
        if (limpio[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        celda += c;
      }
      continue;
    }

    if (c === '"') {
      enComillas = true;
    } else if (c === sep) {
      fila.push(celda);
      celda = "";
    } else if (c === "\n") {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else if (c === "\r") {
      // Final de linea de Windows: el \n que sigue cierra la fila.
    } else {
      celda += c;
    }
  }

  // Una comilla que nunca cierra significa entrada malformada. Antes esto se
  // tragaba en silencio todo lo que venia despues -- separadores y saltos de
  // linea incluidos -- dentro de una sola celda, y las filas siguientes
  // desaparecian sin que nadie se enterara. Mejor fallar fuerte: quien llama
  // lo captura y avisa.
  if (enComillas) {
    throw new Error(
      "El texto tiene una comilla sin cerrar. Revisa el archivo: una comilla suelta hace que se pierdan filas."
    );
  }

  // Ultima celda sin salto de linea al final.
  if (celda !== "" || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }

  return filas;
}

/**
 * Empareja los encabezados del archivo con las columnas de la plantilla.
 * Devuelve una entrada por columna del archivo: la clave que le corresponde,
 * o null si no se reconocio. El usuario puede corregir el mapeo en la UI.
 */
export function guessColumnMapping(headers: string[]): Array<string | null> {
  const usadas = new Set<string>();
  return headers.map((h) => {
    const norm = normalizar(h);
    const match = COLUMNAS_PLANTILLA.find(
      (c) => !usadas.has(c.key) && normalizar(c.label) === norm
    );
    if (!match) return null;
    usadas.add(match.key);
    return match.key;
  });
}

/** Cuenta separadores en la primera linea; gana el que mas aparezca. */
function detectarSeparador(texto: string): string {
  const primera = texto.split("\n", 1)[0] ?? "";
  const tabs = (primera.match(/\t/g) ?? []).length;
  const comas = (primera.match(/,/g) ?? []).length;
  return tabs > comas ? "\t" : ",";
}

/** Minusculas, sin tildes, sin espacios de sobra. */
function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}
```

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `npm test`
Expected: PASS — las anteriores más 14 nuevas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/products/csv-import.ts src/lib/products/csv-import.test.ts
git commit -m "feat(productos): parseo de csv y tsv con mapeo de columnas"
```

---

### Task 4: Partir la barrera y crear productos

Esta tarea toca la garantía central del módulo. Va con TDD estricto.

**Files:**
- Modify: `src/lib/products/write-guard.ts`
- Modify: `src/lib/products/write-guard.test.ts`
- Modify: `src/lib/products/odoo-catalog-write.ts`
- Modify: `src/lib/products/odoo-catalog-write.test.ts`

**Interfaces:**
- Consumes: `ImportRowInput` (Task 1); `odooRpc`, `translateOdooError`.
- Produces:
  - `UPDATE_FIELDS`, `CREATE_FIELDS` (`ReadonlySet<string>`)
  - `assertWritableOnUpdate(values)`, `assertWritableOnCreate(values)`
  - `toOdooCreateValues(row: ProductCreateInput, imageBase64: string | null): Record<string, unknown>`
  - `createTemplate(row: ProductCreateInput, imageBase64: string | null): Promise<number>`

**Por qué se parte la barrera.** Hasta ahora `assertWritable` era una sola lista de 5 campos. La creación necesita 7 más (`name`, `type`, `is_storable`, `list_price`, `standard_price`, `image_1920`, `show_availability`). Si se metieran todos en una sola lista, `standard_price` quedaría permitido también al **actualizar** — y escribir el costo sobre un producto con stock dispara una revalorización contable en Odoo. Dos listas convierten esa regla del spec en algo que el código impide, no algo que hay que recordar.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `src/lib/products/write-guard.test.ts`, **reemplazar** el `describe("barrera de inventario", …)` existente por:

```ts
import { describe, it, expect } from "vitest";
import {
  assertWritableOnUpdate,
  assertWritableOnCreate,
  assertModelAllowed,
  toOdooValues,
  toOdooCreateValues,
  UPDATE_FIELDS,
  CREATE_FIELDS,
} from "./write-guard";
import type { ProductCreateInput } from "./import-types";

const CAMPOS_INVENTARIO = ["qty_available", "inventory_quantity", "free_qty"];

describe("barrera de inventario", () => {
  it("ninguna de las dos listas admite un campo de cantidad", () => {
    for (const campo of CAMPOS_INVENTARIO) {
      expect(UPDATE_FIELDS.has(campo)).toBe(false);
      expect(CREATE_FIELDS.has(campo)).toBe(false);
      expect(() => assertWritableOnUpdate({ [campo]: 10 })).toThrow(/no permitido/i);
      expect(() => assertWritableOnCreate({ [campo]: 10 })).toThrow(/no permitido/i);
    }
  });

  it("rechaza un campo desconocido aunque venga junto a uno valido", () => {
    expect(() => assertWritableOnUpdate({ categ_id: 3, qty_available: 10 })).toThrow(/qty_available/);
    expect(() => assertWritableOnCreate({ name: "x", free_qty: 1 })).toThrow(/free_qty/);
  });

  it("prohibe los modelos que mueven stock", () => {
    for (const modelo of ["stock.quant", "stock.move", "stock.inventory"]) {
      expect(() => assertModelAllowed(modelo)).toThrow(/inventario/i);
    }
    expect(() => assertModelAllowed("product.template")).not.toThrow();
  });
});

describe("el costo y el precio solo se escriben al crear", () => {
  it("standard_price se acepta al crear y se rechaza al actualizar", () => {
    expect(() => assertWritableOnCreate({ standard_price: 500 })).not.toThrow();
    expect(() => assertWritableOnUpdate({ standard_price: 500 })).toThrow(/no permitido/i);
  });

  it("list_price se acepta al crear y se rechaza al actualizar", () => {
    expect(() => assertWritableOnCreate({ list_price: 900 })).not.toThrow();
    expect(() => assertWritableOnUpdate({ list_price: 900 })).toThrow(/no permitido/i);
  });

  it("is_storable se acepta al crear y se rechaza al actualizar", () => {
    expect(() => assertWritableOnCreate({ is_storable: true })).not.toThrow();
    expect(() => assertWritableOnUpdate({ is_storable: true })).toThrow(/no permitido/i);
  });
});

describe("listas fijadas", () => {
  it("la lista de actualizacion son exactamente los cinco campos del catalogo", () => {
    expect(UPDATE_FIELDS.size).toBe(5);
    expect([...UPDATE_FIELDS].sort()).toEqual([
      "categ_id",
      "is_published",
      "public_categ_ids",
      "seller_ids",
      "supplier_taxes_id",
    ]);
  });

  it("la lista de creacion son esos cinco mas los siete de alta", () => {
    expect(CREATE_FIELDS.size).toBe(12);
    expect([...CREATE_FIELDS].sort()).toEqual([
      "categ_id",
      "image_1920",
      "is_published",
      "is_storable",
      "list_price",
      "name",
      "public_categ_ids",
      "seller_ids",
      "show_availability",
      "standard_price",
      "supplier_taxes_id",
      "type",
    ]);
  });

  it("todo lo de actualizacion tambien se puede crear", () => {
    for (const campo of UPDATE_FIELDS) expect(CREATE_FIELDS.has(campo)).toBe(true);
  });
});

function fila(over: Partial<ProductCreateInput> = {}): ProductCreateInput {
  return {
    name: "CUADERNO DEMO",
    productType: "consu",
    isStorable: true,
    qtyOnHand: null,
    salePrice: 1000,
    cost: 600,
    purchaseTaxIds: [],
    categoryId: null,
    imageUrl: null,
    imageData: null,
    isPublished: false,
    publicCategoryIds: [],
    showAvailability: false,
    supplierPartnerId: null,
    ...over,
  };
}

describe("toOdooCreateValues", () => {
  it("traduce lo minimo", () => {
    expect(toOdooCreateValues(fila({ salePrice: null, cost: null }), null)).toEqual({
      name: "CUADERNO DEMO",
      type: "consu",
      is_storable: true,
      is_published: false,
      show_availability: false,
    });
  });

  it("NUNCA emite la cantidad a la mano", () => {
    const v = toOdooCreateValues(fila({ qtyOnHand: 25 }), null);
    expect(v).not.toHaveProperty("qty_available");
    expect(v).not.toHaveProperty("inventory_quantity");
    expect(JSON.stringify(v)).not.toContain("25");
  });

  it("manda precio y costo cuando vienen", () => {
    const v = toOdooCreateValues(fila({ salePrice: 1000, cost: 600 }), null);
    expect(v.list_price).toBe(1000);
    expect(v.standard_price).toBe(600);
  });

  it("usa el comando 6 en los many2many", () => {
    const v = toOdooCreateValues(fila({ purchaseTaxIds: [20], publicCategoryIds: [10] }), null);
    expect(v.supplier_taxes_id).toEqual([[6, 0, [20]]]);
    expect(v.public_categ_ids).toEqual([[6, 0, [10]]]);
  });

  it("crea el proveedor con el comando 0", () => {
    const v = toOdooCreateValues(fila({ supplierPartnerId: 30 }), null);
    expect(v.seller_ids).toEqual([[0, 0, { partner_id: 30 }]]);
  });

  it("adjunta la imagen cuando la hay", () => {
    expect(toOdooCreateValues(fila(), "QUJD").image_1920).toBe("QUJD");
    expect(toOdooCreateValues(fila(), null)).not.toHaveProperty("image_1920");
  });

  it("produce solo campos que la barrera de creacion acepta", () => {
    const v = toOdooCreateValues(
      fila({ categoryId: 1, purchaseTaxIds: [20], publicCategoryIds: [10], supplierPartnerId: 30, qtyOnHand: 9 }),
      "QUJD"
    );
    expect(() => assertWritableOnCreate(v)).not.toThrow();
  });
});
```

Y en `src/lib/products/odoo-catalog-write.test.ts`, **agregar** al final:

```ts
describe("createTemplate", () => {
  it("crea y devuelve el id de Odoo", async () => {
    executeKw.mockResolvedValue(4242);
    const { createTemplate } = await import("./odoo-catalog-write");
    const id = await createTemplate(
      {
        name: "CUADERNO DEMO",
        productType: "consu",
        isStorable: true,
        qtyOnHand: 25,
        salePrice: 1000,
        cost: 600,
        purchaseTaxIds: [],
        categoryId: null,
        imageUrl: null,
        imageData: null,
        isPublished: false,
        publicCategoryIds: [],
        showAvailability: false,
        supplierPartnerId: null,
      },
      null
    );
    expect(id).toBe(4242);
    const [modelo, metodo, args] = executeKw.mock.calls[0];
    expect(modelo).toBe("product.template");
    expect(metodo).toBe("create");
    // La cantidad a la mano NO viaja a Odoo, aunque la fila la traiga.
    expect(JSON.stringify(args)).not.toContain("qty_available");
    expect(JSON.stringify(args)).not.toContain("25");
  });

  it("la barrera esta cableada: un campo prohibido traducido no llega a Odoo", async () => {
    // `toOdooCreateValues` nunca produce un campo prohibido, asi que la unica
    // forma de comprobar que `assertWritableOnCreate` esta REALMENTE en el
    // camino de `createTemplate` es interceptar la traduccion.
    //
    // Sin esta prueba, borrar esa llamada NO rompe ningun test -- verificado
    // a mano: con la linea eliminada, las 81 pruebas restantes pasaban.
    executeKw.mockResolvedValue(4242);
    const { createTemplate } = await import("./odoo-catalog-write");
    const guard = await import("./write-guard");
    const spy = vi.spyOn(guard, "toOdooCreateValues").mockReturnValue({ qty_available: 5 });
    try {
      await expect(
        createTemplate(
          {
            name: "CUADERNO DEMO",
            productType: "consu",
            isStorable: true,
            qtyOnHand: null,
            salePrice: null,
            cost: null,
            purchaseTaxIds: [],
            categoryId: null,
            imageUrl: null,
            imageData: null,
            isPublished: false,
            publicCategoryIds: [],
            showAvailability: false,
            supplierPartnerId: null,
          },
          null
        )
      ).rejects.toThrow(/no permitido/i);
      expect(executeKw).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test`
Expected: FAIL — `assertWritableOnUpdate`, `CREATE_FIELDS`, `toOdooCreateValues` y `createTemplate` no existen.

- [ ] **Step 3: Partir la barrera**

En `src/lib/products/write-guard.ts`, reemplazar el bloque de `WRITABLE_FIELDS` y `assertWritable` por:

```ts
/**
 * Barrera de escritura del catalogo. Sin imports de Odoo, Prisma ni entorno:
 * tiene que poder probarse sola, porque es la garantia de que Utilia nunca
 * mueve inventario en produccion.
 *
 * Son DOS listas, no una, y la diferencia importa:
 *
 *  - `UPDATE_FIELDS` es lo que se puede escribir sobre un producto que ya
 *    existe y puede tener stock.
 *  - `CREATE_FIELDS` agrega lo que solo es seguro al dar de alta, con el
 *    producto todavia en cero.
 *
 * El caso que obliga a separarlas es `standard_price`: escribir el costo
 * sobre un producto con stock dispara una revalorizacion contable en Odoo.
 * Al crear no hay stock, asi que no produce ningun asiento. Lo mismo vale
 * para `list_price`, que ademas quedo fuera de la edicion masiva por
 * prudencia comercial, y para `is_storable`, que ES el rastreo de inventario.
 *
 * `qty_available`, `inventory_quantity` y `free_qty` quedan fuera de AMBAS
 * por construccion: ponerle cantidad a un producto exige un ajuste de
 * inventario, y eso es exactamente lo que este modulo no puede hacer.
 *
 * Regla para mantenerlas: un campo entra en el MISMO cambio que introduce
 * quien lo escribe, nunca antes.
 */
export const UPDATE_FIELDS: ReadonlySet<string> = new Set([
  "categ_id",
  "is_published",
  "public_categ_ids",
  "supplier_taxes_id",
  "seller_ids",
]);

/** Solo seguros al dar de alta, con el producto en cero. */
const CREATE_ONLY_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "type",
  "is_storable",
  "list_price",
  "standard_price",
  "image_1920",
  "show_availability",
]);

export const CREATE_FIELDS: ReadonlySet<string> = new Set([
  ...UPDATE_FIELDS,
  ...CREATE_ONLY_FIELDS,
]);

export function assertWritableOnUpdate(values: Record<string, unknown>): void {
  assertEn(values, UPDATE_FIELDS, "actualizacion");
}

export function assertWritableOnCreate(values: Record<string, unknown>): void {
  assertEn(values, CREATE_FIELDS, "creacion");
}

function assertEn(
  values: Record<string, unknown>,
  permitidos: ReadonlySet<string>,
  operacion: string
): void {
  for (const campo of Object.keys(values)) {
    if (!permitidos.has(campo)) {
      throw new Error(`Campo no permitido en ${operacion} de catalogo: ${campo}`);
    }
  }
}
```

Y agregar al final del archivo:

```ts
/**
 * Traduce una fila de la hoja a los valores de creacion de Odoo.
 *
 * `qtyOnHand` NO aparece aqui y no debe aparecer nunca: se captura para
 * exportarla como pendiente y que el dueño la cargue en Odoo, porque
 * escribirla exigiria un ajuste de inventario.
 */
export function toOdooCreateValues(
  row: ProductCreateInput,
  imageBase64: string | null
): Record<string, unknown> {
  const v: Record<string, unknown> = {
    name: row.name.trim(),
    type: row.productType,
    // Odoo solo admite rastreo en bienes; la validacion ya lo garantiza,
    // pero aqui se fuerza para que un dato viejo no cree un servicio raro.
    is_storable: row.productType === "consu" ? row.isStorable : false,
    is_published: row.isPublished,
    show_availability: row.showAvailability,
  };

  if (row.salePrice !== null) v.list_price = row.salePrice;
  if (row.cost !== null) v.standard_price = row.cost;
  if (row.categoryId !== null) v.categ_id = row.categoryId;
  if (row.purchaseTaxIds.length > 0) v.supplier_taxes_id = [[6, 0, row.purchaseTaxIds]];
  if (row.publicCategoryIds.length > 0) v.public_categ_ids = [[6, 0, row.publicCategoryIds]];
  // Comando 0: crear el product.supplierinfo junto con la plantilla.
  if (row.supplierPartnerId !== null) {
    v.seller_ids = [[0, 0, { partner_id: row.supplierPartnerId }]];
  }
  if (imageBase64) v.image_1920 = imageBase64;

  return v;
}
```

Agregar el import del tipo al principio del archivo:

```ts
import type { ProductCreateInput } from "./import-types";
```

- [ ] **Step 4: Actualizar el llamador existente y agregar `createTemplate`**

En `src/lib/products/odoo-catalog-write.ts`:

1. Cambiar el import de `./write-guard` para traer `assertWritableOnUpdate`, `assertWritableOnCreate`, `assertModelAllowed`, `toOdooValues`, `toOdooCreateValues`.
2. En `updateTemplates`, cambiar la llamada `assertWritable(values)` por `assertWritableOnUpdate(values)`.
3. Agregar al final:

```ts
/**
 * Crea UNA plantilla de producto en Odoo y devuelve su id.
 *
 * Se llama en serie desde la creacion por tandas: Odoo.sh estrangula la
 * concurrencia, y en serie los resultados se corresponden fila a fila.
 *
 * Crear un producto NO mueve inventario: nace en cero. La cantidad a la mano
 * se captura en la hoja y se exporta como pendiente, nunca se escribe.
 */
export async function createTemplate(
  row: ProductCreateInput,
  imageBase64: string | null
): Promise<number> {
  assertModelAllowed(MODEL);
  const values = toOdooCreateValues(row, imageBase64);
  assertWritableOnCreate(values);

  return odooRpc.executeKw<number>(MODEL, "create", [values], {}, ODOO_WRITE_TIMEOUT_MS);
}
```

Y su import de tipo:

```ts
import type { ProductCreateInput } from "./import-types";
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npm test`
Expected: PASS — todas, incluidas las nuevas de barrera y creación.

- [ ] **Step 6: Verificar tipos y lint**

Run: `npm run lint && npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 7: Commit**

```bash
git add src/lib/products/write-guard.ts src/lib/products/write-guard.test.ts src/lib/products/odoo-catalog-write.ts src/lib/products/odoo-catalog-write.test.ts
git commit -m "feat(productos): barrera separada para creacion y alta de productos en odoo"
```

---

### Task 5: Borrador persistente

**Files:**
- Create: `src/app/(dashboard)/productos/cargar/actions.ts`

**Interfaces:**
- Consumes: `ImportRowInput`, `ImportRowDraft`, `MAX_ROWS_PER_BATCH`, `MAX_IMAGE_BASE64_BYTES` (Task 1); `prisma`; `auth`.
- Produces (server actions):
  - `saveBatch(input): Promise<{ ok: boolean; error?: string; batchId?: string }>`
  - `loadBatch(batchId): Promise<{ ok: boolean; error?: string; batch?: { id, name, status, rows: ImportRowDraft[] } }>`


- [ ] **Step 1: Escribir las server actions**

`src/app/(dashboard)/productos/cargar/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  MAX_IMAGE_BASE64_BYTES,
  MAX_ROWS_PER_BATCH,
  type ImportRowDraft,
} from "@/lib/products/import-types";
import type { ProductType } from "@/lib/products/types";

// Un archivo "use server" solo puede exportar funciones async; los tipos
// quedan internos.
type SaveResult = { ok: boolean; error?: string; batchId?: string };
type LoadResult = {
  ok: boolean;
  error?: string;
  batch?: { id: string; name: string; status: string; rows: ImportRowDraft[] };
};

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("No autorizado");
  return session;
}

const filaSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  name: z.string().max(300),
  productType: z.enum(["consu", "service", "combo"]),
  isStorable: z.boolean(),
  qtyOnHand: z.number().nonnegative().nullable(),
  salePrice: z.number().nonnegative().nullable(),
  cost: z.number().nonnegative().nullable(),
  purchaseTaxIds: z.array(z.number().int().positive()).max(20),
  categoryId: z.number().int().positive().nullable(),
  imageUrl: z.string().max(2000).nullable(),
  imageData: z
    .string()
    .max(MAX_IMAGE_BASE64_BYTES, {
      message: `Cada imagen debe pesar menos de ${Math.round(MAX_IMAGE_BASE64_BYTES / 1000)} KB una vez reducida`,
    })
    .nullable(),
  isPublished: z.boolean(),
  publicCategoryIds: z.array(z.number().int().positive()).max(20),
  showAvailability: z.boolean(),
  supplierPartnerId: z.number().int().positive().nullable(),
});

const saveSchema = z.object({
  batchId: z.string().min(1).nullable(),
  name: z.string().min(1, { message: "Ponle un nombre al lote" }).max(120),
  rows: z.array(filaSchema).max(MAX_ROWS_PER_BATCH, {
    message: `Máximo ${MAX_ROWS_PER_BATCH} filas por lote. Divide la lista en tandas.`,
  }),
});

/**
 * Guarda el borrador completo: crea el lote si no existe y reemplaza sus
 * filas. Se reemplazan y no se diffean porque la hoja es pequeña (tope de
 * 200 filas) y un diff por indice se rompe en cuanto el usuario inserta una
 * fila en medio.
 *
 * Solo toca filas que no se hayan creado todavia: una fila ya OK en Odoo
 * conserva su id y su estado, porque volver a crearla duplicaria el producto.
 */
export async function saveBatch(input: unknown): Promise<SaveResult> {
  const session = await requireSession();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const { batchId, name, rows } = parsed.data;

  try {
    const lote = batchId
      ? await prisma.productImportBatch.update({ where: { id: batchId }, data: { name } })
      : await prisma.productImportBatch.create({
          data: { name, createdBy: session.user?.id ?? null },
        });

    const insertadas = await prisma.$transaction(async (tx) => {
      // Las filas ya creadas en Odoo se conservan tal cual.
      await tx.productImportRow.deleteMany({
        where: { batchId: lote.id, status: { not: "OK" } },
      });
      const { count } = await tx.productImportRow.createMany({
        data: rows.map((r) => ({ ...r, batchId: lote.id })),
        skipDuplicates: true,
      });
      return count;
    });

    // Cualquier fila entrante que caiga sobre el indice de una ya creada en
    // Odoo es un choque, sin excepcion: `saveBatch` solo se llama mientras el
    // lote esta en borrador, y en borrador no existen filas OK. Si llega una,
    // es un bug de la UI, y hay que gritarlo -- no tragarselo.
    //
    // Contar y comparar NO sirve aqui: una fila distinta sentada en un indice
    // OK se salta igual que la fila OK reenviada, la aritmetica se equilibra
    // y el choque pasa desapercibido. Verificado empiricamente.
    if (insertadas < rows.length) {
      return {
        ok: false,
        error:
          "Algunas filas chocan con productos que ya se crearon en Odoo. Cierra este lote y empieza uno nuevo con las que falten.",
      };
    }

    return { ok: true, batchId: lote.id };
  } catch (err) {
    console.error("[cargar] fallo al guardar el borrador:", err);
    // P2025: el lote ya no existe. Reintentar con el mismo id fallaria igual,
    // asi que no hay que decirle al usuario que lo intente de nuevo.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "Ese lote ya no existe. Empieza uno nuevo." };
    }
    return { ok: false, error: "No se pudo guardar el borrador. Intenta de nuevo." };
  }
}

export async function loadBatch(batchId: unknown): Promise<LoadResult> {
  await requireSession();
  const id = z.string().min(1).safeParse(batchId);
  if (!id.success) return { ok: false, error: "Lote inválido" };

  try {
    const lote = await prisma.productImportBatch.findUnique({
      where: { id: id.data },
      include: { rows: { orderBy: { rowIndex: "asc" } } },
    });
    if (!lote) return { ok: false, error: "Ese lote ya no existe" };

    return {
      ok: true,
      batch: {
        id: lote.id,
        name: lote.name,
        status: lote.status,
        rows: lote.rows.map(
          (r): ImportRowDraft => ({
            id: r.id,
            // El id de Postgres sirve de identidad estable en el navegador.
            clientId: r.id,
            rowIndex: r.rowIndex,
            name: r.name,
            productType: r.productType as ProductType,
            isStorable: r.isStorable,
            qtyOnHand: r.qtyOnHand,
            salePrice: r.salePrice,
            cost: r.cost,
            purchaseTaxIds: r.purchaseTaxIds,
            categoryId: r.categoryId,
            imageUrl: r.imageUrl,
            imageData: r.imageData,
            isPublished: r.isPublished,
            publicCategoryIds: r.publicCategoryIds,
            showAvailability: r.showAvailability,
            supplierPartnerId: r.supplierPartnerId,
            status: r.status,
            odooTemplateId: r.odooTemplateId,
            error: r.error,
            warning: r.warning,
          })
        ),
      },
    };
  } catch (err) {
    console.error("[cargar] fallo al leer el borrador:", err);
    return { ok: false, error: "No se pudo leer el borrador." };
  }
}

```

- [ ] **Step 2: Comprobar el ciclo con un script desechable**

Crear `scripts/_check-batch.ts`:

```ts
import { prisma } from "../src/lib/prisma";

(async () => {
  const lote = await prisma.productImportBatch.create({
    data: {
      name: "PRUEBA LOCAL - borrar",
      rows: {
        create: [
          { rowIndex: 0, name: "FILA DEMO", productType: "consu", isStorable: true, qtyOnHand: 7 },
        ],
      },
    },
    include: { rows: true },
  });
  console.log("creado:", lote.id, "filas:", lote.rows.length, "qtyOnHand:", lote.rows[0].qtyOnHand);

  await prisma.productImportBatch.delete({ where: { id: lote.id } });
  const quedan = await prisma.productImportRow.count({ where: { batchId: lote.id } });
  console.log("tras borrar el lote, filas huerfanas:", quedan, "(esperado 0)");
  await prisma.$disconnect();
})();
```

Run: `npx tsx --env-file=.env.local scripts/_check-batch.ts`
Expected: `filas: 1`, `qtyOnHand: 7`, y `filas huerfanas: 0` — el cascade funciona.

- [ ] **Step 3: Borrar el script desechable**

```bash
rm scripts/_check-batch.ts
```

Este sí es desechable: comprueba el esquema una vez, no es una herramienta de diagnóstico recurrente como `check-catalog` o `verify-inventario`.

- [ ] **Step 4: Verificar**

Run: `npm test && npm run lint && npx tsc --noEmit && git status --short`
Expected: todo limpio, sin archivos sueltos en `scripts/`.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/productos/cargar/actions.ts
git commit -m "feat(productos): guardado y lectura del borrador de carga"
```

---

### Task 6: La hoja editable

Al terminar esta tarea se puede escribir y pegar una lista, ver los errores por celda y guardar el borrador. Todavía no crea nada en Odoo.

**Files:**
- Create: `src/lib/products/image-resize.ts`
- Create: `src/app/(dashboard)/productos/cargar/page.tsx`
- Create: `src/components/products/ImportSheet.tsx`
- Create: `src/components/products/ImportSheetRow.tsx`
- Create: `src/components/products/ImageCell.tsx`
- Modify: `src/app/(dashboard)/productos/page.tsx`

**Interfaces:**
- Consumes: `validateRow`, `rowIsCreatable` (Task 2); `parseDelimited`, `guessColumnMapping`, `COLUMNAS_PLANTILLA` (Task 3); `saveBatch`, `loadBatch` (Task 5); `getCatalogOptions` (Fase 1); `ImportRowInput`, `CellError`, `MAX_ROWS_PER_BATCH`, `MAX_IMAGE_BASE64_BYTES` (Task 1).
- Produces:
  - `resizeImageToBase64(file: File): Promise<string>` (`image-resize.ts`)
  - `<ImportSheet options={CatalogOptions} batchId={string | null} />`
  - `<ImportSheetRow row onChange errors options onRemove />`
  - `<ImageCell value onChange />`

- [ ] **Step 1: Reducción de imagen en el navegador**

`src/lib/products/image-resize.ts`:

```ts
import { MAX_IMAGE_BASE64_BYTES } from "./import-types";

/** Mismo tope al que Odoo reduce image_1920. */
const MAX_LADO = 1920;
const CALIDAD_JPEG = 0.85;

/**
 * Reduce una imagen en el navegador y devuelve su base64 SIN el prefijo
 * `data:` (que es lo que Odoo espera en image_1920).
 *
 * Se reduce antes de subir, no en el servidor, por dos razones: el borrador
 * guarda el base64 en Postgres y una foto de celular sin reducir lo llenaria,
 * y subir 4 MB por fila para que el servidor los tire es desperdicio.
 */
export async function resizeImageToBase64(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Ese archivo no es una imagen");
  }

  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no pudo procesar la imagen");
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", CALIDAD_JPEG);
  const base64 = dataUrl.split(",")[1] ?? "";

  if (base64.length > MAX_IMAGE_BASE64_BYTES) {
    throw new Error(
      `La imagen sigue pesando demasiado tras reducirla (${Math.round(base64.length / 1000)} KB). Usa una más liviana.`
    );
  }
  return base64;
}
```

- [ ] **Step 2: La celda de imagen**

`src/components/products/ImageCell.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { ImagePlus, Link2, X } from "lucide-react";
import { resizeImageToBase64 } from "@/lib/products/image-resize";

export function ImageCell({
  imageUrl,
  imageData,
  onChange,
}: {
  imageUrl: string | null;
  imageData: string | null;
  onChange: (cambio: { imageUrl: string | null; imageData: string | null }) => void;
}) {
  const inputArchivo = useRef<HTMLInputElement>(null);
  const [modo, setModo] = useState<"none" | "link">(imageUrl ? "link" : "none");
  const [error, setError] = useState<string | null>(null);

  async function elegirArchivo(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const base64 = await resizeImageToBase64(file);
      // El archivo gana sobre el link: son excluyentes.
      onChange({ imageData: base64, imageUrl: null });
      setModo("none");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo procesar la imagen");
    }
  }

  if (imageData) {
    return (
      <div className="flex items-center gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/jpeg;base64,${imageData}`} alt="" className="h-8 w-8 rounded object-cover" />
        <button
          onClick={() => onChange({ imageData: null, imageUrl: null })}
          aria-label="Quitar la imagen"
          className="text-muted-foreground hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {modo === "link" ? (
        <input
          value={imageUrl ?? ""}
          onChange={(e) => onChange({ imageUrl: e.target.value || null, imageData: null })}
          placeholder="https://…"
          aria-label="Link de la imagen"
          className="w-full rounded border border-border bg-background px-1.5 py-1 text-xs"
        />
      ) : (
        <div className="flex gap-1">
          <button
            onClick={() => inputArchivo.current?.click()}
            aria-label="Subir una imagen desde el computador"
            className="rounded border border-border p-1 text-muted-foreground hover:bg-secondary"
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setModo("link")}
            aria-label="Pegar el link de una imagen"
            className="rounded border border-border p-1 text-muted-foreground hover:bg-secondary"
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <input
        ref={inputArchivo}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => elegirArchivo(e.target.files?.[0])}
      />
      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3: La fila**

`src/components/products/ImportSheetRow.tsx`:

```tsx
"use client";

import { useId } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ImageCell } from "./ImageCell";
import type { CellError, ImportRowInput } from "@/lib/products/import-types";
import type { CatalogOptions } from "@/lib/products/types";

const TIPOS: Array<{ value: ImportRowInput["productType"]; label: string }> = [
  { value: "consu", label: "Bienes" },
  { value: "service", label: "Servicio" },
  { value: "combo", label: "Combo" },
];

export function ImportSheetRow({
  row,
  errors,
  options,
  onChange,
  onRemove,
  onPasteRows,
}: {
  row: ImportRowInput;
  errors: CellError[];
  options: CatalogOptions;
  onChange: (cambio: Partial<ImportRowInput>) => void;
  onRemove: () => void;
  /** Pegado multi-celda: la fila sabe cual es su indice, la hoja no. */
  onPasteRows: (e: React.ClipboardEvent) => void;
}) {
  const problema = (campo: keyof ImportRowInput) => errors.find((e) => e.field === campo);

  // El color solo no basta: quien navega con teclado o lector de pantalla no
  // ve un borde rojo, y `title` casi nunca se anuncia al enfocar. Cada celda
  // con problema se marca invalida y apunta a su mensaje.
  //
  // El prefijo sale de `useId` y NO de `row.clientId`: ese viene de
  // `crypto.randomUUID()`, que da un valor distinto en el servidor y en el
  // cliente, y el `id` renderizado provocaria un aviso de hidratacion en cada
  // carga (la fila vacia ya trae el error "El nombre es obligatorio", asi que
  // el span se pinta desde el primer render). `useId` existe exactamente para
  // esto: es estable entre servidor y cliente.
  const uid = useId();
  const idError = (campo: keyof ImportRowInput) => `${uid}-${String(campo)}`;
  const ariaCelda = (campo: keyof ImportRowInput) =>
    problema(campo) ? { "aria-invalid": true, "aria-describedby": idError(campo) } : {};

  const claseCelda = (campo: keyof ImportRowInput) => {
    const p = problema(campo);
    return cn(
      "w-full rounded border bg-background px-1.5 py-1 text-xs",
      p?.level === "error"
        ? "border-destructive"
        : p?.level === "warning"
          ? "border-warning"
          : "border-border"
    );
  };
  const numero = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <tr className="border-b border-border last:border-0 align-top" onPasteCapture={onPasteRows}>
      <td className="p-1">
        <input
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value })}
          title={problema("name")?.message}
          aria-label="Nombre del producto"
          {...ariaCelda("name")}
          className={claseCelda("name")}
        />
      </td>
      <td className="p-1">
        <select
          value={row.productType}
          onChange={(e) => {
            const productType = e.target.value as ImportRowInput["productType"];
            // Odoo solo admite rastreo en bienes: al cambiar de tipo se apaga
            // solo, para que el usuario no quede con una celda en rojo que no
            // pidio.
            const esBien = productType === "consu";
            onChange({
              productType,
              isStorable: esBien ? row.isStorable : false,
              qtyOnHand: esBien ? row.qtyOnHand : null,
            });
          }}
          aria-label="Tipo de producto"
          {...ariaCelda("productType")}
          className={claseCelda("productType")}
        >
          {TIPOS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </td>
      <td className="p-1 text-center">
        <input
          type="checkbox"
          checked={row.isStorable}
          disabled={row.productType !== "consu"}
          onChange={(e) => onChange({ isStorable: e.target.checked })}
          title={problema("isStorable")?.message}
          aria-label="Rastreo de inventario"
          {...ariaCelda("isStorable")}
          className="h-3.5 w-3.5 accent-primary disabled:opacity-40"
        />
      </td>
      <td className="p-1">
        <input
          type="number"
          value={row.qtyOnHand ?? ""}
          disabled={row.productType !== "consu"}
          onChange={(e) => onChange({ qtyOnHand: numero(e.target.value) })}
          title={problema("qtyOnHand")?.message}
          aria-label="Cantidad a la mano"
          {...ariaCelda("qtyOnHand")}
          className={claseCelda("qtyOnHand")}
        />
      </td>
      <td className="p-1">
        <input
          type="number"
          value={row.salePrice ?? ""}
          onChange={(e) => onChange({ salePrice: numero(e.target.value) })}
          title={problema("salePrice")?.message}
          aria-label="Precio de venta"
          {...ariaCelda("salePrice")}
          className={claseCelda("salePrice")}
        />
      </td>
      <td className="p-1">
        <input
          type="number"
          value={row.cost ?? ""}
          onChange={(e) => onChange({ cost: numero(e.target.value) })}
          title={problema("cost")?.message}
          aria-label="Costo"
          {...ariaCelda("cost")}
          className={claseCelda("cost")}
        />
      </td>
      <td className="p-1">
        <select
          value={row.purchaseTaxIds[0] ?? ""}
          onChange={(e) => onChange({ purchaseTaxIds: e.target.value ? [Number(e.target.value)] : [] })}
          aria-label="Impuesto de compra"
          {...ariaCelda("purchaseTaxIds")}
          className={claseCelda("purchaseTaxIds")}
        >
          <option value="">—</option>
          {options.purchaseTaxes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </td>
      <td className="p-1">
        <select
          value={row.categoryId ?? ""}
          onChange={(e) => onChange({ categoryId: e.target.value ? Number(e.target.value) : null })}
          aria-label="Categoría interna"
          {...ariaCelda("categoryId")}
          className={claseCelda("categoryId")}
        >
          <option value="">—</option>
          {options.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </td>
      <td className="p-1">
        <ImageCell
          imageUrl={row.imageUrl}
          imageData={row.imageData}
          onChange={(cambio) => onChange(cambio)}
        />
      </td>
      <td className="p-1 text-center">
        <input
          type="checkbox"
          checked={row.isPublished}
          onChange={(e) => onChange({ isPublished: e.target.checked })}
          aria-label="Publicado en la tienda"
          className="h-3.5 w-3.5 accent-primary"
        />
      </td>
      <td className="p-1">
        <select
          value={row.publicCategoryIds[0] ?? ""}
          onChange={(e) => onChange({ publicCategoryIds: e.target.value ? [Number(e.target.value)] : [] })}
          title={problema("publicCategoryIds")?.message}
          aria-label="Categoría de la tienda"
          {...ariaCelda("publicCategoryIds")}
          className={claseCelda("publicCategoryIds")}
        >
          <option value="">—</option>
          {options.publicCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </td>
      <td className="p-1 text-center">
        <input
          type="checkbox"
          checked={row.showAvailability}
          onChange={(e) => onChange({ showAvailability: e.target.checked })}
          aria-label="Mostrar las cantidades disponibles"
          className="h-3.5 w-3.5 accent-primary"
        />
      </td>
      <td className="p-1">
        <select
          value={row.supplierPartnerId ?? ""}
          onChange={(e) => onChange({ supplierPartnerId: e.target.value ? Number(e.target.value) : null })}
          aria-label="Proveedor"
          {...ariaCelda("supplierPartnerId")}
          className={claseCelda("supplierPartnerId")}
        >
          <option value="">—</option>
          {options.suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </td>
      <td className="p-1">
        <button onClick={onRemove} aria-label="Quitar la fila" className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        {/* Los mensajes para lector de pantalla van juntos aqui, no bajo cada
            celda: la tabla ya es densa y meterlos en linea la romperia. Cada
            control los alcanza por aria-describedby. */}
        {errors.map((e) => (
          <span key={String(e.field)} id={idError(e.field)} className="sr-only">
            {e.message}
          </span>
        ))}
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: La hoja**

`src/components/products/ImportSheet.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";
import { ImportSheetRow } from "./ImportSheetRow";
import { validateRow, rowIsCreatable } from "@/lib/products/import-schema";
import { parseDelimited } from "@/lib/products/csv-import";
import { saveBatch } from "@/app/(dashboard)/productos/cargar/actions";
import { filaVacia, MAX_ROWS_PER_BATCH, type ImportRowInput } from "@/lib/products/import-types";
import type { CatalogOptions } from "@/lib/products/types";

const ENCABEZADOS = [
  "Nombre", "Tipo", "Rastreo", "Cantidad", "Precio", "Costo", "Impuesto",
  "Categoría", "Imagen", "Publicado", "Cat. tienda", "Disponibilidad", "Proveedor", "",
];

export function ImportSheet({ options }: { options: CatalogOptions }) {
  const [nombre, setNombre] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [filas, setFilas] = useState<ImportRowInput[]>([filaVacia(0)]);
  const [guardando, setGuardando] = useState(false);

  const errores = useMemo(
    () => filas.map((f) => validateRow(f, options)),
    [filas, options]
  );
  const conError = errores.filter((e) => !rowIsCreatable(e)).length;

  function cambiar(i: number, cambio: Partial<ImportRowInput>) {
    setFilas((prev) => prev.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  }

  function quitar(i: number) {
    setFilas((prev) => prev.filter((_, j) => j !== i).map((f, j) => ({ ...f, rowIndex: j })));
  }


  function agregar() {
    setFilas((prev) =>
      prev.length >= MAX_ROWS_PER_BATCH ? prev : [...prev, filaVacia(prev.length)]
    );
  }

  /**
   * Pegar desde Excel: si el portapapeles trae varias celdas, se reparte a
   * partir de la fila donde se pego, creando filas si hacen falta.
   *
   * El reparto es POSICIONAL, en el orden de la plantilla (nombre, tipo,
   * rastreo, cantidad, precio, costo, ...). Solo se rellenan las columnas de
   * texto y numero: un id de Odoo no se puede adivinar desde un nombre
   * pegado, asi que categoria, impuesto y proveedor se quedan como estan.
   * Para una lista con las columnas en otro orden esta "Importar CSV", que
   * empareja por encabezado.
   */
  function pegar(e: React.ClipboardEvent, desdeFila: number) {
    const texto = e.clipboardData.getData("text/plain");
    if (!texto.includes("\t") && !texto.includes("\n")) return; // una sola celda: comportamiento normal

    let matriz: string[][];
    try {
      matriz = parseDelimited(texto);
    } catch {
      // Comilla sin cerrar: no es un pegado multi-celda valido. Se deja que
      // el navegador pegue el texto tal cual en la celda, que es lo que el
      // usuario espera si lo que copio no era una tabla.
      return;
    }
    e.preventDefault();
    setFilas((prev) => {
      const next = [...prev];
      matriz.forEach((cols, k) => {
        const i = desdeFila + k;
        if (i >= MAX_ROWS_PER_BATCH) return;
        if (!next[i]) next[i] = filaVacia(i);
        const num = (v: string | undefined) => (v && v.trim() !== "" ? Number(v) : null);
        const txt = (v: string | undefined) =>
          (v ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        // Tipo y rastreo llegan como texto libre desde la hoja de calculo.
        // Si la celda viene vacia se conserva lo que ya tenia la fila.
        const tipoPegado = txt(cols[1]);
        const productType: ImportRowInput["productType"] =
          tipoPegado === "servicio" || tipoPegado === "service"
            ? "service"
            : tipoPegado === "combo"
              ? "combo"
              : tipoPegado === "bienes" || tipoPegado === "consu"
                ? "consu"
                : next[i].productType;

        // Odoo solo admite rastreo en bienes: un servicio pegado apaga el
        // rastreo y la cantidad, igual que hace el selector de la fila.
        const esBien = productType === "consu";
        const rastreoPegado = txt(cols[2]);
        const isStorable = !esBien
          ? false
          : rastreoPegado
            ? ["si", "x", "true", "1", "yes", "verdadero"].includes(rastreoPegado)
            : next[i].isStorable;

        next[i] = {
          ...next[i],
          name: cols[0] ?? next[i].name,
          productType,
          isStorable,
          qtyOnHand: esBien ? (num(cols[3]) ?? next[i].qtyOnHand) : null,
          salePrice: num(cols[4]) ?? next[i].salePrice,
          cost: num(cols[5]) ?? next[i].cost,
        };
      });
      return next.map((f, j) => ({ ...f, rowIndex: j }));
    });
  }

  async function guardar() {
    if (!nombre.trim()) {
      toast.error("Ponle un nombre al lote para poder guardarlo");
      return;
    }
    setGuardando(true);
    try {
      const res = await saveBatch({ batchId, name: nombre, rows: filas });
      if (!res.ok) {
        toast.error(res.error ?? "No se pudo guardar");
        return;
      }
      setBatchId(res.batchId ?? null);
      toast.success("Borrador guardado");
    } catch (err) {
      console.error("[cargar] la accion de guardar no llego al servidor:", err);
      toast.error("No se pudo contactar al servidor. Revisa la conexión.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del lote (ej: Lista Distribuidora — septiembre)"
          aria-label="Nombre del lote"
          className="flex-1 min-w-[240px] rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
        />
        <button
          onClick={guardar}
          disabled={guardando}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" /> {guardando ? "Guardando…" : "Guardar borrador"}
        </button>
        <span className="text-xs text-muted-foreground">
          {filas.length} fila{filas.length !== 1 ? "s" : ""}
          {conError > 0 ? ` · ${conError} con error` : ""}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              {ENCABEZADOS.map((h, i) => (
                <th key={i} className="py-2 px-1 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <ImportSheetRow
                key={f.clientId}
                row={f}
                errors={errores[i]}
                options={options}
                onChange={(cambio) => cambiar(i, cambio)}
                onRemove={() => quitar(i)}
                onPasteRows={(e) => pegar(e, i)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Puedes pegar varias filas desde Excel o Google Sheets sobre cualquier celda. Se reparten en el orden de
        la plantilla: nombre, tipo, rastreo, cantidad, precio, costo. Si tu lista trae las columnas en otro
        orden, usa “Importar CSV”, que las empareja por el encabezado.
      </p>

      <button
        onClick={agregar}
        disabled={filas.length >= MAX_ROWS_PER_BATCH}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" /> Agregar fila
      </button>
    </div>
  );
}
```

- [ ] **Step 5: La página**

`src/app/(dashboard)/productos/cargar/page.tsx`:

```tsx
export const dynamic = "force-dynamic";
// La creacion corre por tandas desde el cliente, pero cada tanda es una
// server action de esta pagina: hereda este presupuesto.
export const maxDuration = 300;

import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { getCatalogOptions } from "@/lib/products/catalog";
import { ImportSheet } from "@/components/products/ImportSheet";

export default async function CargarPage() {
  let options: Awaited<ReturnType<typeof getCatalogOptions>> | null = null;
  try {
    options = await getCatalogOptions();
  } catch (err) {
    console.error("[cargar] fallo la lectura de catalogos:", err);
  }

  if (!options) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Cargar productos</h1>
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              No se pudieron leer las categorías e impuestos de Odoo. Sin ellos la hoja no puede validar.
            </p>
            <Link href="/productos/cargar" className="text-xs font-medium text-primary hover:underline">
              Reintentar
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Cargar productos</h1>
        <Link
          href="/productos"
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver al catálogo
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground leading-relaxed">
        La <span className="font-semibold text-foreground">cantidad a la mano</span> se guarda aquí pero{" "}
        <span className="font-semibold text-foreground">no se escribe en Odoo</span>: ponerle cantidad a un
        producto exige un ajuste de inventario, y Utilia no los hace. Al terminar la carga te damos la lista de
        cantidades pendientes para que las cargues en Odoo.
      </div>

      <ImportSheet options={options} />
    </div>
  );
}
```

- [ ] **Step 6: Enlace desde el catálogo**

En `src/app/(dashboard)/productos/page.tsx`, reemplazar el encabezado `<h1 className="text-xl font-bold">Productos</h1>` (aparece dos veces — en el estado de error y en el normal; cambiar **solo el del render normal**) por:

```tsx
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Productos</h1>
        <Link
          href="/productos/cargar"
          className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
        >
          Cargar productos →
        </Link>
      </div>
```

- [ ] **Step 7: Verificar en el navegador**

Abrir `/productos/cargar` con el servidor de desarrollo (Browser pane, config `utilia-dev` — nunca `npm run dev` en Bash). Comprobar:

1. La hoja carga con una fila vacía y los selectores traen categorías, impuestos y proveedores reales.
2. Escribir un nombre y dejar el resto vacío: la fila no marca error.
3. Vaciar el nombre: la celda se pone roja.
4. Cambiar el tipo a "Servicio": el checkbox de rastreo y la cantidad se deshabilitan y se limpian solos.
5. Marcar "Publicado" sin categoría de tienda: la celda de categoría de tienda se pone ámbar (advertencia), no roja.
6. Pegar tres filas desde una hoja de cálculo con nombre/cantidad/precio/costo: se crean tres filas con esos valores.
7. Poner nombre al lote y "Guardar borrador": toast de éxito.
8. La consola del navegador no tiene errores.

- [ ] **Step 8: Verificar lint, tipos y pruebas**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 9: Commit**

```bash
git add src/lib/products/image-resize.ts src/app/\(dashboard\)/productos/cargar/page.tsx src/app/\(dashboard\)/productos/page.tsx src/components/products/ImportSheet.tsx src/components/products/ImportSheetRow.tsx src/components/products/ImageCell.tsx
git commit -m "feat(productos): hoja editable de carga con validacion por celda"
```

---

### Task 7: Importar CSV y descargar la plantilla

**Files:**
- Create: `src/components/products/ImportToolbar.tsx`
- Modify: `src/components/products/ImportSheet.tsx`

**Interfaces:**
- Consumes: `parseDelimited`, `guessColumnMapping`, `COLUMNAS_PLANTILLA` (Task 3); `buildCsv`, `downloadCsv` de `@/lib/csv`; `filaVacia` (Task 6).
- Produces: `<ImportToolbar options onRows />` donde `onRows: (filas: ImportRowInput[]) => void`.

Contexto: el importador **rellena la hoja**; no crea nada. Los valores de texto que corresponden a un catálogo (categoría, impuesto, proveedor) se resuelven por **nombre exacto**, ignorando mayúsculas y tildes; si no matchean, la celda queda vacía y la validación la marcará.

- [ ] **Step 1: Crear la barra de importación**

`src/components/products/ImportToolbar.tsx`:

```tsx
"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { parseDelimited, guessColumnMapping, COLUMNAS_PLANTILLA } from "@/lib/products/csv-import";
import { filaVacia, MAX_ROWS_PER_BATCH, type ImportRowInput } from "@/lib/products/import-types";
import type { CatalogOptions, ProductType } from "@/lib/products/types";

export function ImportToolbar({
  options,
  onRows,
}: {
  options: CatalogOptions;
  onRows: (filas: ImportRowInput[]) => void;
}) {
  const inputArchivo = useRef<HTMLInputElement>(null);

  function descargarPlantilla() {
    const csv = buildCsv(
      [],
      COLUMNAS_PLANTILLA.map((c) => ({ header: c.label, value: () => "" }))
    );
    downloadCsv("plantilla-productos.csv", csv);
  }

  async function importar(file: File | undefined) {
    if (!file) return;
    const texto = await file.text();
    let matriz: string[][];
    try {
      matriz = parseDelimited(texto);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo leer el archivo");
      return;
    }
    if (matriz.length < 2) {
      toast.error("El archivo no trae filas debajo del encabezado");
      return;
    }

    const mapeo = guessColumnMapping(matriz[0]);
    const reconocidas = mapeo.filter(Boolean).length;
    if (reconocidas === 0) {
      toast.error("No se reconoció ninguna columna. Descarga la plantilla y usa sus encabezados.");
      return;
    }

    const cuerpo = matriz.slice(1, MAX_ROWS_PER_BATCH + 1);
    const filas = cuerpo.map((cols, i) => aFila(cols, mapeo, i, options));
    onRows(filas);

    const ignoradas = matriz.length - 1 - cuerpo.length;
    toast.success(
      `${filas.length} filas importadas${reconocidas < mapeo.length ? `, ${mapeo.length - reconocidas} columnas sin reconocer` : ""}` +
        (ignoradas > 0 ? `. Se ignoraron ${ignoradas} por el tope de ${MAX_ROWS_PER_BATCH}.` : "")
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => inputArchivo.current?.click()}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"
      >
        <Upload className="h-3.5 w-3.5" /> Importar CSV
      </button>
      <button
        onClick={descargarPlantilla}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"
      >
        <Download className="h-3.5 w-3.5" /> Descargar plantilla
      </button>
      <input
        ref={inputArchivo}
        type="file"
        accept=".csv,.tsv,.txt,text/csv"
        hidden
        onChange={(e) => {
          importar(e.target.files?.[0]);
          // Permite volver a elegir el mismo archivo tras corregirlo.
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Convierte una fila cruda del archivo en una fila de la hoja. */
function aFila(
  cols: string[],
  mapeo: Array<string | null>,
  rowIndex: number,
  options: CatalogOptions
): ImportRowInput {
  const fila = filaVacia(rowIndex);
  const valor = (key: string): string => {
    const i = mapeo.indexOf(key);
    return i === -1 ? "" : (cols[i] ?? "").trim();
  };
  const numero = (key: string): number | null => {
    const v = valor(key);
    if (!v) return null;
    // Los miles con punto y los decimales con coma son lo normal en Colombia.
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  const booleano = (key: string): boolean => {
    const v = normalizar(valor(key));
    return v === "si" || v === "x" || v === "true" || v === "1";
  };
  const porNombre = (lista: Array<{ id: number; name: string }>, key: string): number | null => {
    const v = normalizar(valor(key));
    if (!v) return null;
    return lista.find((o) => normalizar(o.name) === v)?.id ?? null;
  };

  const tipoTexto = normalizar(valor("productType"));
  const productType: ProductType =
    tipoTexto === "servicio" || tipoTexto === "service"
      ? "service"
      : tipoTexto === "combo"
        ? "combo"
        : "consu";
  const esBien = productType === "consu";

  const impuesto = porNombre(options.purchaseTaxes, "purchaseTax");
  const catTienda = porNombre(options.publicCategories, "publicCategory");

  return {
    ...fila,
    name: valor("name") || fila.name,
    productType,
    isStorable: esBien ? (valor("isStorable") ? booleano("isStorable") : true) : false,
    qtyOnHand: esBien ? numero("qtyOnHand") : null,
    salePrice: numero("salePrice"),
    cost: numero("cost"),
    purchaseTaxIds: impuesto !== null ? [impuesto] : [],
    categoryId: porNombre(options.categories, "category"),
    imageUrl: valor("imageUrl") || null,
    isPublished: booleano("isPublished"),
    publicCategoryIds: catTienda !== null ? [catTienda] : [],
    showAvailability: booleano("showAvailability"),
    supplierPartnerId: porNombre(options.suppliers, "supplier"),
  };
}

function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}
```

- [ ] **Step 2: Conectarla a la hoja**

En `src/components/products/ImportSheet.tsx`:

1. Agregar el import: `import { ImportToolbar } from "./ImportToolbar";`
2. Justo encima del bloque `<div className="flex items-center gap-2 flex-wrap">` del nombre del lote, insertar:

```tsx
      <ImportToolbar
        options={options}
        onRows={(nuevas) => setFilas(nuevas.length > 0 ? nuevas : [filaVacia(0)])}
      />
```

- [ ] **Step 3: Verificar en el navegador**

1. "Descargar plantilla" baja un CSV con los 13 encabezados y ninguna fila.
2. Llenar dos filas en esa plantilla (nombre, precio, costo, y una categoría escrita **exactamente** como aparece en Odoo) e importarla: la hoja se rellena, la categoría queda seleccionada, y el toast dice "2 filas importadas".
3. Escribir una categoría inventada e importar: esa celda queda vacía, no rompe nada.
4. Importar un archivo con solo encabezados: toast de error "no trae filas debajo del encabezado".

- [ ] **Step 4: Verificar lint, tipos y pruebas**

Run: `npm test && npm run lint && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/components/products/ImportToolbar.tsx src/components/products/ImportSheet.tsx
git commit -m "feat(productos): importacion de csv y plantilla descargable"
```

---

### Task 8: Creación en Odoo por tandas

Al terminar esta tarea el módulo está completo: se carga la lista y se crean los productos.

**Files:**
- Modify: `src/app/(dashboard)/productos/cargar/actions.ts`
- Create: `src/components/products/ImportResult.tsx`
- Modify: `src/components/products/ImportSheet.tsx`
- Modify: `docs/superpowers/specs/2026-09-04-modulo-productos-design.md`

**Interfaces:**
- Consumes: `createTemplate` (Task 4); `saveBatch` (Task 5); `ImportProgress`, `CREATE_SLICE_SIZE` (Task 1); `translateOdooError`.
- Produces:
  - `createBatchSlice(batchId): Promise<{ ok: boolean; error?: string; progress?: ImportProgress }>`
  - `<ImportResult rows onRetry onClose />`

**Por qué por tandas.** Crear 200 productos en serie, con descarga de imagen incluida, puede pasarse de los 300 s de la función. Cada invocación crea `CREATE_SLICE_SIZE` filas y devuelve el progreso; el cliente vuelve a llamar hasta que `done` sea true. Eso da barra de progreso, ningún riesgo de corte, y reanudación gratis: las filas ya OK no se reintentan.

- [ ] **Step 1: Agregar la acción de creación**

Al final de `src/app/(dashboard)/productos/cargar/actions.ts`:

```ts
import { createTemplate } from "@/lib/products/odoo-catalog-write";
import { translateOdooError } from "@/lib/odoo-write";
import { CREATE_SLICE_SIZE, type ImportProgress } from "@/lib/products/import-types";
import type { ProductType } from "@/lib/products/types";

type CreateResult = { ok: boolean; error?: string; progress?: ImportProgress };

/** Tope para bajar una imagen por link. Corto a proposito: una imagen lenta
 *  no debe consumir el presupuesto de toda la tanda. */
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

/**
 * Crea UNA tanda de filas pendientes y devuelve el progreso. El cliente la
 * vuelve a llamar hasta que `done` sea true.
 *
 * Cada fila se marca OK o ERROR inmediatamente despues de su create, asi que
 * un corte a mitad no duplica productos: al reintentar solo se toman las que
 * no quedaron OK.
 */
export async function createBatchSlice(batchId: unknown): Promise<CreateResult> {
  await requireSession();
  const id = z.string().min(1).safeParse(batchId);
  if (!id.success) return { ok: false, error: "Lote inválido" };

  try {
    await prisma.productImportBatch.update({
      where: { id: id.data },
      data: { status: "CREATING" },
    });

    const pendientes = await prisma.productImportRow.findMany({
      where: { batchId: id.data, status: { not: "OK" } },
      orderBy: { rowIndex: "asc" },
      take: CREATE_SLICE_SIZE,
    });

    for (const fila of pendientes) {
      let warning: string | null = null;
      let imagen: string | null = fila.imageData;

      if (!imagen && fila.imageUrl) {
        try {
          imagen = await descargarImagen(fila.imageUrl);
        } catch (err) {
          // Una imagen rota no debe costar el producto.
          console.error(`[cargar] no se pudo bajar la imagen de la fila ${fila.rowIndex}:`, err);
          warning = "El producto se creó sin imagen: el link no se pudo descargar";
        }
      }

      try {
        const odooTemplateId = await createTemplate(
          {
            name: fila.name,
            productType: fila.productType as ProductType,
            isStorable: fila.isStorable,
            qtyOnHand: fila.qtyOnHand,
            salePrice: fila.salePrice,
            cost: fila.cost,
            purchaseTaxIds: fila.purchaseTaxIds,
            categoryId: fila.categoryId,
            imageUrl: fila.imageUrl,
            imageData: fila.imageData,
            isPublished: fila.isPublished,
            publicCategoryIds: fila.publicCategoryIds,
            showAvailability: fila.showAvailability,
            supplierPartnerId: fila.supplierPartnerId,
          },
          imagen
        );

        // Se marca OK y se suelta el base64 en el mismo update: un lote
        // terminado no debe arrastrar imagenes en Postgres.
        await prisma.productImportRow.update({
          where: { id: fila.id },
          data: { status: "OK", odooTemplateId, error: null, warning, imageData: null },
        });
      } catch (err) {
        await prisma.productImportRow.update({
          where: { id: fila.id },
          data: { status: "ERROR", error: translateOdooError(err, "catalogo") },
        });
      }
    }

    const [okCount, errorCount, remaining] = await Promise.all([
      prisma.productImportRow.count({ where: { batchId: id.data, status: "OK" } }),
      prisma.productImportRow.count({ where: { batchId: id.data, status: "ERROR" } }),
      prisma.productImportRow.count({ where: { batchId: id.data, status: "PENDING" } }),
    ]);
    const done = remaining === 0;

    await prisma.productImportBatch.update({
      where: { id: id.data },
      data: { status: done ? (errorCount > 0 ? "PARTIAL" : "DONE") : "CREATING" },
    });

    return {
      ok: true,
      progress: { processed: pendientes.length, okCount, errorCount, remaining, done },
    };
  } catch (err) {
    console.error("[cargar] fallo la tanda de creacion:", err);
    return { ok: false, error: "No se pudo crear la tanda. Revisa la conexión con Odoo." };
  }
}

/** Baja una imagen por link y la devuelve en base64 sin prefijo `data:`. */
async function descargarImagen(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tipo = res.headers.get("content-type") ?? "";
  if (!tipo.startsWith("image/")) throw new Error(`No es una imagen: ${tipo}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 5_000_000) throw new Error("La imagen pesa más de 5 MB");
  return Buffer.from(buf).toString("base64");
}
```

Nota: `createBatchSlice` reintenta también las filas en `ERROR`, porque `status: { not: "OK" }` las incluye. Eso es deliberado — el botón "Reintentar los que fallaron" no necesita lógica aparte.

- [ ] **Step 2: La pantalla de resultado**

`src/components/products/ImportResult.tsx`:

```tsx
"use client";

import { CheckCircle, XCircle, AlertTriangle, Download } from "lucide-react";
import { buildCsv, downloadCsv } from "@/lib/csv";
import type { ImportRowDraft } from "@/lib/products/import-types";

export function ImportResult({
  rows,
  onRetry,
  onClose,
  retrying,
}: {
  rows: ImportRowDraft[];
  onRetry: () => void;
  onClose: () => void;
  retrying: boolean;
}) {
  const ok = rows.filter((r) => r.status === "OK");
  const fallidas = rows.filter((r) => r.status === "ERROR");
  const avisos = ok.filter((r) => r.warning);
  const pendientesCantidad = ok.filter((r) => r.qtyOnHand !== null && r.qtyOnHand > 0);

  function descargarPendientes() {
    const csv = buildCsv(pendientesCantidad, [
      { header: "ID Odoo", value: (r) => r.odooTemplateId ?? "" },
      { header: "Producto", value: (r) => r.name },
      { header: "Cantidad a cargar", value: (r) => r.qtyOnHand ?? 0 },
    ]);
    downloadCsv("cantidades-pendientes.csv", csv);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 text-center">
          <CheckCircle className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-2xl font-bold text-primary">{ok.length}</p>
          <p className="text-xs text-muted-foreground">creados en Odoo</p>
        </div>
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-center">
          <XCircle className="h-5 w-5 text-destructive mx-auto mb-1" />
          <p className="text-2xl font-bold text-destructive">{fallidas.length}</p>
          <p className="text-xs text-muted-foreground">fallaron</p>
        </div>
      </div>

      {pendientesCantidad.length > 0 ? (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">
                {pendientesCantidad.length} producto{pendientesCantidad.length !== 1 ? "s" : ""} nacieron en cero.
              </span>{" "}
              Utilia no mueve inventario, así que las cantidades que anotaste quedan pendientes de cargar en Odoo.
            </p>
          </div>
          <button
            onClick={descargarPendientes}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-secondary"
          >
            <Download className="h-3.5 w-3.5" /> Descargar cantidades pendientes
          </button>
        </div>
      ) : null}

      {avisos.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs font-semibold">Creados con advertencia</p>
          {avisos.slice(0, 10).map((r) => (
            <p key={r.id} className="text-xs text-muted-foreground">
              {r.name}: {r.warning}
            </p>
          ))}
        </div>
      ) : null}

      {fallidas.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-semibold">Filas que fallaron</p>
          {fallidas.slice(0, 20).map((r) => (
            <p key={r.id} className="text-xs text-muted-foreground">
              <span className="text-foreground">{r.name || `Fila ${r.rowIndex + 1}`}</span>: {r.error}
            </p>
          ))}
          <button
            onClick={onRetry}
            disabled={retrying}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {retrying ? "Reintentando…" : `Reintentar ${fallidas.length}`}
          </button>
        </div>
      ) : null}

      <button
        onClick={onClose}
        className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"
      >
        Cerrar y empezar otro lote
      </button>
    </div>
  );
}
```

- [ ] **Step 3: El bucle de creación en la hoja**

En `src/components/products/ImportSheet.tsx`:

1. Agregar imports:

```tsx
import { ImportResult } from "./ImportResult";
import { createBatchSlice, loadBatch } from "@/app/(dashboard)/productos/cargar/actions";
import type { ImportRowDraft } from "@/lib/products/import-types";
```

2. Agregar estado junto a los existentes:

```tsx
  const [creando, setCreando] = useState(false);
  const [progreso, setProgreso] = useState<{ ok: number; error: number; faltan: number } | null>(null);
  const [resultado, setResultado] = useState<ImportRowDraft[] | null>(null);
```

3. Agregar la función:

```tsx
  /**
   * Guarda y luego crea por tandas hasta terminar. El bucle vive en el
   * cliente a proposito: cada tanda es su propia server action, asi que
   * ninguna se acerca al limite de tiempo de la funcion.
   */
  async function crearEnOdoo() {
    if (conError > 0) {
      toast.error(`Corrige las ${conError} filas en rojo antes de crear`);
      return;
    }
    if (!nombre.trim()) {
      toast.error("Ponle un nombre al lote");
      return;
    }

    setCreando(true);
    try {
      const guardado = await saveBatch({ batchId, name: nombre, rows: filas });
      if (!guardado.ok || !guardado.batchId) {
        toast.error(guardado.error ?? "No se pudo guardar antes de crear");
        return;
      }
      const id = guardado.batchId;
      setBatchId(id);

      // Tope de vueltas: filas / tanda, con margen. Sin el, un `done` que
      // nunca llegue por un bug giraria para siempre.
      const maxVueltas = Math.ceil(MAX_ROWS_PER_BATCH / 20) + 5;
      for (let vuelta = 0; vuelta < maxVueltas; vuelta++) {
        const res = await createBatchSlice(id);
        if (!res.ok || !res.progress) {
          toast.error(res.error ?? "Falló la creación");
          return;
        }
        setProgreso({
          ok: res.progress.okCount,
          error: res.progress.errorCount,
          faltan: res.progress.remaining,
        });
        if (res.progress.done) break;
      }

      const leido = await loadBatch(id);
      if (leido.ok && leido.batch) setResultado(leido.batch.rows);
    } catch (err) {
      console.error("[cargar] la creacion no llego al servidor:", err);
      toast.error("No se pudo contactar al servidor. Revisa la conexión.");
    } finally {
      setCreando(false);
    }
  }

  /**
   * Reintenta las filas que fallaron. NO vuelve a guardar el borrador.
   *
   * Volver a llamar a `saveBatch` aqui seria un error: el lote ya tiene filas
   * en OK, y reenviar la hoja completa haria que una fila cualquiera cayera
   * sobre el indice de un producto ya creado. `saveBatch` solo se llama
   * mientras el lote esta en borrador; despues de crear, el lote persistido
   * ES la verdad y solo hay que seguir procesandolo.
   */
  async function reintentar() {
    if (!batchId) return;
    setCreando(true);
    try {
      const maxVueltas = Math.ceil(MAX_ROWS_PER_BATCH / 20) + 5;
      for (let vuelta = 0; vuelta < maxVueltas; vuelta++) {
        const res = await createBatchSlice(batchId);
        if (!res.ok || !res.progress) {
          toast.error(res.error ?? "Falló el reintento");
          return;
        }
        setProgreso({
          ok: res.progress.okCount,
          error: res.progress.errorCount,
          faltan: res.progress.remaining,
        });
        if (res.progress.done) break;
      }
      const leido = await loadBatch(batchId);
      if (leido.ok && leido.batch) setResultado(leido.batch.rows);
    } catch (err) {
      console.error("[cargar] el reintento no llego al servidor:", err);
      toast.error("No se pudo contactar al servidor. Revisa la conexión.");
    } finally {
      setCreando(false);
    }
  }
```

4. Agregar el botón junto a "Guardar borrador":

```tsx
        <button
          onClick={crearEnOdoo}
          disabled={creando || guardando || filas.length === 0}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {creando
            ? progreso
              ? `Creando… ${progreso.ok} listos, faltan ${progreso.faltan}`
              : "Creando…"
            : "Crear en Odoo"}
        </button>
```

5. **Después de todos los hooks** (`useState`, `useMemo`) y antes del `return` principal — nunca encima de los hooks, o React se quejará de un número variable de hooks entre renders — mostrar el resultado cuando exista:

```tsx
  if (resultado) {
    return (
      <ImportResult
        rows={resultado}
        retrying={creando}
        onRetry={reintentar}
        onClose={() => {
          setResultado(null);
          setProgreso(null);
          setBatchId(null);
          setNombre("");
          setFilas([filaVacia(0)]);
        }}
      />
    );
  }
```

- [ ] **Step 4: Documentar el procedimiento de verificación en el spec**

Al final de `docs/superpowers/specs/2026-09-04-modulo-productos-design.md`, antes de "## Pendientes conocidos", agregar:

```markdown
## Verificación de la barrera al crear (Fase 2)

Crear un producto **no puede** mover inventario: nace en cero, y `qtyOnHand`
nunca sale de Postgres. La garantía dura está en el código —
`assertWritableOnCreate` no admite `qty_available`, `inventory_quantity` ni
`free_qty`, y hay una prueba que falla si alguien los agrega — pero conviene
confirmarlo una vez contra producción.

**Decisión del dueño:** no se crean productos de prueba. La verificación se
hace con la primera carga real, que de todos modos iba a ocurrir:

1. Antes de darle "Crear en Odoo": `npm run verify:inventario antes`
2. Cargar el lote normalmente.
3. Después: `npm run verify:inventario despues`

**Resultado esperado:** `OK: cero ajustes de inventario nuevos sobre N
plantillas comparadas.` Las plantillas nuevas aparecerán como "nuevas desde la
foto" — eso es correcto, son los productos que acabas de crear. Lo que no debe
aparecer es un solo ajuste de inventario.

Si aparecen ajustes, hay que mirarlos en Odoo antes de concluir nada: el
script no puede distinguir un ajuste hecho por la app de uno hecho a mano,
porque la API usa la misma cuenta que el POS (ver § Limitación conocida).
```

- [ ] **Step 5: Verificar en el navegador SIN crear nada**

Abrir `/productos/cargar`. Comprobar, **sin pulsar "Crear en Odoo"**:

1. Con una fila en rojo, "Crear en Odoo" muestra el toast "corrige las N filas en rojo" y no llama al servidor (comprobarlo en la pestaña de red).
2. Sin nombre de lote, muestra "Ponle un nombre al lote".
3. Con todo válido, el botón queda habilitado.

La creación real contra Odoo la hace el dueño con su primera lista, según el procedimiento del Step 4. **No crear productos de prueba en producción.**

- [ ] **Step 6: Verificar lint, tipos y pruebas**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(dashboard\)/productos/cargar/actions.ts src/components/products/ImportResult.tsx src/components/products/ImportSheet.tsx docs/superpowers/specs/2026-09-04-modulo-productos-design.md
git commit -m "feat(productos): creacion en odoo por tandas con reintento y pendientes"
```

---

## Fuera de este plan

- **Variantes.** El módulo trabaja a nivel `product.template`. Crear atributos y variantes se sigue haciendo en Odoo.
- **Editar un producto existente desde la hoja.** La hoja solo crea. Corregir uno ya creado se hace con las acciones masivas de Fase 1 o en Odoo.
- **Mapeo manual de columnas.** El importador reconoce los encabezados de la plantilla; si no coinciden, la celda queda vacía y se corrige a mano en la hoja. Una pantalla de "esta columna es el costo" se puede agregar después si la fricción lo justifica.
- **Limpieza de borradores abandonados.** Un lote que se empieza y no se termina queda en Postgres para siempre; no hay pantalla que los liste ni acción que los borre. Con el tope de 200 filas por lote el volumen es pequeño, pero si se vuelve molesto hace falta una pantalla de "mis lotes" con su borrado.
- **Los tres pendientes de Fase 1** siguen abiertos y anotados en el spec: la carrera de la caja de búsqueda, el foco que no vuelve al disparador, y extraer `parseFilters`/`paginaValida`/`qs` a `src/lib/products/query.ts`.
