# Plan de Liquidación de Capital Muerto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/liquidacion` page — a new dashboard screen showing the full list of dead stock (capital muerto), a discount-scenario simulator, an auto-tracked cash-release goal, and a category breakdown, per the approved spec at `docs/superpowers/specs/2026-07-05-liquidacion-capital-muerto-design.md`.

**Architecture:** One new analytics module (`dead-stock.ts`) computing the dead-stock dataset and the goal's progress from already-synced `ProductInsight`/`Setting` data (no new DB tables, no migration). One server action for editing the goal. Four new client components following the exact patterns already established by `CashBalanceEditor`, `InventoryTable`, and `ABCTable` in this codebase (reuse `table-controls.tsx` and `csv.ts`, already built in PR #13). One new server-component page assembling everything, plus a one-line nav addition.

**Tech Stack:** Next.js 15 App Router, React Server + Client Components, Prisma, Tailwind, `sonner` for toasts, `zod` for server-action validation. No test runner exists in this repo (`npm run build` has no `test` script — verified: `package.json` has no `test`/`vitest`/`jest` entry). Verification in every task below uses `npx tsc --noEmit` (must produce no output) for type-correctness, and the final task uses a full `npm run build` plus live browser verification via the preview tools — this mirrors exactly how the four prior PRs in this session (#11–#14) were verified, since there is no unit-test infrastructure to write tests against.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/analytics/dead-stock.ts` | Create | Types + `getDeadStockAnalysis()` + `getLiquidationGoal()` + `setLiquidationGoal()` |
| `src/app/(dashboard)/liquidacion/actions.ts` | Create | Server action `updateLiquidationGoal(formData)` — mirrors `financiero/actions.ts` |
| `src/components/dashboard/LiquidationGoalEditor.tsx` | Create | Editable goal card — mirrors `CashBalanceEditor.tsx` |
| `src/components/dashboard/DiscountScenarioCalculator.tsx` | Create | Preset/custom discount buttons + recovered-cash summary |
| `src/components/dashboard/DeadStockTable.tsx` | Create | Full sortable/filterable/exportable table — mirrors `InventoryTable.tsx` |
| `src/components/dashboard/LiquidationWorkspace.tsx` | Create | Client orchestrator holding shared `discountPct` state for the calculator + table |
| `src/app/(dashboard)/liquidacion/page.tsx` | Create | Server component: fetch + verdict banner + category breakdown + assembly |
| `src/components/layout/nav-config.tsx` | Modify | Add `/liquidacion` nav item after `/compras` |

**Deliberate scope note (documented here, not a silent deviation from the spec):** the spec says the discount calculator should "respetar el filtro de categoría activo" of the table. Implementing that would require lifting the table's category-filter state up into `LiquidationWorkspace` and passing filtered data back down — breaking the established pattern where each table (`InventoryTable`, `ABCTable`, `ComprasTable`) owns its own filter state independently. Instead, `DiscountScenarioCalculator` always computes over the **full** dead-stock dataset ("if you liquidate everything at X% off"), which is the actually decision-relevant number; the table's own category filter/search/sort/export remain fully independent, exactly like every other table in the app. Only `discountPct` is shared between the two siblings.

---

### Task 1: Analytics module — types and `getDeadStockAnalysis()`

**Files:**
- Create: `src/lib/analytics/dead-stock.ts`

- [ ] **Step 1: Write the file with types and the main query function**

```ts
import { prisma } from "@/lib/prisma";

export interface DeadStockProduct {
  id: string;
  name: string;
  category: string | null;
  stockQty: number;
  cmp: number;
  salePrice: number;
  rotationDays: number;
  lastSoldAt: Date | null;
  investedCapital: number; // stockQty * cmp
  retailValue: number;     // stockQty * salePrice
}

export interface DeadStockByCategory {
  category: string;
  investedCapital: number;
  retailValue: number;
  productCount: number;
}

export interface DeadStockAnalysis {
  products: DeadStockProduct[];      // todos, sin cap — la tabla filtra/pagina en cliente
  totalInvestedCapital: number;
  totalRetailValue: number;
  totalInventoryValue: number;       // valor de TODO el inventario con stock > 0
  deadStockPctOfInventory: number;   // totalInvestedCapital / totalInventoryValue * 100
  byCategory: DeadStockByCategory[]; // ordenado por investedCapital desc
}

/**
 * Capital muerto = productos con stock que no se han vendido en 30+ días
 * (rotationDays > 30 AND stockQty > 0). Sin consolidar variantes por
 * template: liquidar es una acción física por SKU concreto (el color/talla
 * exacto que sobra), a diferencia del análisis de revenue en ABC/Oportunidades
 * donde promediar variantes por velocidad sí tiene sentido.
 */
export async function getDeadStockAnalysis(): Promise<DeadStockAnalysis> {
  const [deadRows, allRows] = await Promise.all([
    prisma.productInsight.findMany({
      where: { rotationDays: { gt: 30 }, stockQty: { gt: 0 } },
      orderBy: { rotationDays: "desc" },
    }),
    prisma.productInsight.findMany({
      where: { stockQty: { gt: 0 } },
      select: { stockQty: true, cmp: true },
    }),
  ]);

  const products: DeadStockProduct[] = deadRows.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    stockQty: p.stockQty,
    cmp: p.cmp,
    salePrice: p.salePrice,
    rotationDays: p.rotationDays,
    lastSoldAt: p.lastSoldAt,
    investedCapital: p.stockQty * p.cmp,
    retailValue: p.stockQty * p.salePrice,
  }));

  const totalInvestedCapital = products.reduce((s, p) => s + p.investedCapital, 0);
  const totalRetailValue = products.reduce((s, p) => s + p.retailValue, 0);
  const totalInventoryValue = allRows.reduce((s, r) => s + r.stockQty * r.cmp, 0);
  const deadStockPctOfInventory = totalInventoryValue > 0 ? (totalInvestedCapital / totalInventoryValue) * 100 : 0;

  const catMap = new Map<string, { investedCapital: number; retailValue: number; productCount: number }>();
  for (const p of products) {
    const key = p.category ?? "Sin categoría";
    const cur = catMap.get(key) ?? { investedCapital: 0, retailValue: 0, productCount: 0 };
    cur.investedCapital += p.investedCapital;
    cur.retailValue += p.retailValue;
    cur.productCount += 1;
    catMap.set(key, cur);
  }
  const byCategory: DeadStockByCategory[] = Array.from(catMap.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.investedCapital - a.investedCapital);

  return {
    products,
    totalInvestedCapital,
    totalRetailValue,
    totalInventoryValue,
    deadStockPctOfInventory,
    byCategory,
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output (exit code 0). If Prisma complains about `ProductInsight` fields, re-check `prisma/schema.prisma` — the fields used (`rotationDays`, `stockQty`, `cmp`, `salePrice`, `category`, `name`, `lastSoldAt`) already exist on the model (no migration needed for this task).

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/dead-stock.ts
git commit -m "feat(liquidacion): módulo de análisis de capital muerto"
```

---

### Task 2: Analytics module — liquidation goal (Setting-backed, auto-computed progress)

**Files:**
- Modify: `src/lib/analytics/dead-stock.ts`

- [ ] **Step 1: Append the goal types and functions to the same file**

```ts
const GOAL_AMOUNT_KEY = "dead_stock_goal_amount";
const GOAL_BASELINE_KEY = "dead_stock_goal_baseline";

export interface LiquidationGoal {
  goalAmount: number;        // 0 = sin meta fijada
  baseline: number;          // capital muerto total al momento de fijar la meta
  updatedAt: Date | null;
  currentDeadStock: number;  // pasado por el caller — evita una consulta duplicada
}

/**
 * El progreso de la meta es 100% derivado de datos reales, sin ninguna
 * acción manual de "marcar como liquidado": progreso = baseline - capital
 * muerto actual. A medida que el sync de Odoo refleje que ese stock
 * efectivamente se vendió, el capital muerto baja solo y la meta avanza.
 *
 * `currentDeadStock` se recibe como parámetro (no se recalcula aquí) porque
 * el caller (la página) ya llamó a getDeadStockAnalysis() — evita una
 * segunda consulta concurrente redundante contra el mismo pool de conexiones
 * (lección de la PR #12: apilar fetches concurrentes de más agota el pool
 * local de conexiones y hace fallar otras queries en silencio).
 */
export async function getLiquidationGoal(currentDeadStock: number): Promise<LiquidationGoal> {
  const [goalRow, baselineRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: GOAL_AMOUNT_KEY } }),
    prisma.setting.findUnique({ where: { key: GOAL_BASELINE_KEY } }),
  ]);
  const goalAmount = goalRow ? Number(goalRow.value) : 0;
  const baseline = baselineRow ? Number(baselineRow.value) : 0;
  return {
    goalAmount: Number.isFinite(goalAmount) ? goalAmount : 0,
    baseline: Number.isFinite(baseline) ? baseline : 0,
    updatedAt: goalRow?.updatedAt ?? null,
    currentDeadStock,
  };
}

/** Fija una meta nueva: guarda el monto Y la línea base (capital muerto actual) juntos, para que el progreso arranque en 0%. */
export async function setLiquidationGoal(goalAmount: number, baseline: number): Promise<void> {
  await prisma.$transaction([
    prisma.setting.upsert({
      where: { key: GOAL_AMOUNT_KEY },
      create: { key: GOAL_AMOUNT_KEY, value: String(goalAmount) },
      update: { value: String(goalAmount) },
    }),
    prisma.setting.upsert({
      where: { key: GOAL_BASELINE_KEY },
      create: { key: GOAL_BASELINE_KEY, value: String(baseline) },
      update: { value: String(baseline) },
    }),
  ]);
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/dead-stock.ts
git commit -m "feat(liquidacion): meta de liberación de caja con progreso automático"
```

---

### Task 3: Server action to update the goal

**Files:**
- Create: `src/app/(dashboard)/liquidacion/actions.ts`

- [ ] **Step 1: Write the action, mirroring `src/app/(dashboard)/financiero/actions.ts`**

```ts
"use server";

import { setLiquidationGoal, getDeadStockAnalysis } from "@/lib/analytics/dead-stock";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const goalSchema = z.object({
  amount: z.coerce.number().positive().max(10_000_000_000),
});

export async function updateLiquidationGoal(formData: FormData) {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado" };

  const parsed = goalSchema.safeParse({ amount: formData.get("amount") });
  if (!parsed.success) {
    return { ok: false, error: "Monto inválido" };
  }

  try {
    const analysis = await getDeadStockAnalysis();
    await setLiquidationGoal(parsed.data.amount, analysis.totalInvestedCapital);
    revalidatePath("/liquidacion");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/liquidacion/actions.ts
git commit -m "feat(liquidacion): server action para fijar la meta de liberación"
```

---

### Task 4: `LiquidationGoalEditor` component

**Files:**
- Create: `src/components/dashboard/LiquidationGoalEditor.tsx`

- [ ] **Step 1: Write the component, mirroring `src/components/dashboard/CashBalanceEditor.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { updateLiquidationGoal } from "@/app/(dashboard)/liquidacion/actions";
import { Target, Edit2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

interface Props {
  goalAmount: number;
  baseline: number;
  currentDeadStock: number;
  updatedAt: Date | null;
}

export function LiquidationGoalEditor({ goalAmount, baseline, currentDeadStock, updatedAt }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(goalAmount > 0 ? String(goalAmount) : "");

  function handleSave() {
    const fd = new FormData();
    fd.set("amount", value);
    startTransition(async () => {
      const r = await updateLiquidationGoal(fd);
      if (r.ok) {
        toast.success(`Meta actualizada: ${formatCurrency(Number(value))}`);
        setEditing(false);
      } else {
        toast.error(r.error ?? "Error al guardar");
      }
    });
  }

  const hasGoal = goalAmount > 0;
  const progress = hasGoal ? Math.max(baseline - currentDeadStock, 0) : 0;
  const pct = hasGoal ? (progress / goalAmount) * 100 : 0;
  const pctClamped = Math.min(Math.max(pct, 0), 100);

  const lastUpdate = updatedAt
    ? new Date(updatedAt).toLocaleString("es-CO", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Bogota",
      })
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Meta de liberación de caja</p>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Fijar meta"
          >
            <Edit2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-sm">$</span>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            autoFocus
            min="1"
            placeholder="Ej. 5000000"
            className="flex-1 rounded border border-border bg-input px-2 py-1 text-base font-bold focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button onClick={handleSave} disabled={pending} className="rounded p-1.5 text-primary hover:bg-primary/10 disabled:opacity-50" title="Guardar">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { setEditing(false); setValue(goalAmount > 0 ? String(goalAmount) : ""); }}
            disabled={pending}
            className="rounded p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : !hasGoal ? (
        <p className="text-sm font-medium text-muted-foreground">Sin meta fijada — click en el lápiz para empezar</p>
      ) : (
        <>
          <div className="flex items-end justify-between text-xs">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary">{formatCurrency(progress)}</span>
              <span className="text-muted-foreground">de {formatCurrency(goalAmount)}</span>
            </div>
            <span className="font-medium text-primary">{pct.toFixed(0)}%</span>
          </div>
          <div className="h-3 w-full rounded-full bg-secondary/40 overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pctClamped}%` }} />
          </div>
        </>
      )}

      {lastUpdate && !editing && hasGoal && (
        <p className="text-xs text-muted-foreground">Meta fijada: {lastUpdate}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/LiquidationGoalEditor.tsx
git commit -m "feat(liquidacion): componente editor de meta con progreso automático"
```

---

### Task 5: `DiscountScenarioCalculator` component

**Files:**
- Create: `src/components/dashboard/DiscountScenarioCalculator.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { formatCurrency, cn } from "@/lib/utils";
import type { DeadStockProduct } from "@/lib/analytics/dead-stock";

const PRESETS = [20, 30, 50];

interface Props {
  products: DeadStockProduct[];
  discountPct: number;
  onChangeDiscount: (pct: number) => void;
}

export function DiscountScenarioCalculator({ products, discountPct, onChangeDiscount }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState(String(discountPct));

  const totalInvested = products.reduce((s, p) => s + p.investedCapital, 0);
  const recovered = products.reduce((s, p) => s + p.retailValue * (1 - discountPct / 100), 0);
  const net = recovered - totalInvested;
  const isPresetActive = PRESETS.includes(discountPct) && !customOpen;

  function applyCustom() {
    const n = Math.max(0, Math.min(90, Number(customValue) || 0));
    onChangeDiscount(n);
    setCustomOpen(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">Simulador de liquidación</h3>
        <div className="flex items-center gap-1.5 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => { onChangeDiscount(p); setCustomOpen(false); setCustomValue(String(p)); }}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                discountPct === p && !customOpen
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card hover:bg-secondary"
              )}
            >
              {p}% off
            </button>
          ))}
          {customOpen ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                autoFocus
                min="0"
                max="90"
                className="w-16 rounded border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button onClick={applyCustom} className="rounded-lg bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground">
                Aplicar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCustomOpen(true)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                !isPresetActive ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-secondary"
              )}
            >
              Otro %
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Capital invertido</p>
          <p className="text-xl font-bold">{formatCurrency(totalInvested)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Recuperas con {discountPct}% off</p>
          <p className="text-xl font-bold text-primary">{formatCurrency(recovered)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{net >= 0 ? "Ganancia neta" : "Pérdida neta"}</p>
          <p className={cn("text-xl font-bold", net >= 0 ? "text-primary" : "text-destructive")}>
            {formatCurrency(Math.abs(net))}
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/DiscountScenarioCalculator.tsx
git commit -m "feat(liquidacion): calculadora de escenarios de descuento"
```

---

### Task 6: `DeadStockTable` component

**Files:**
- Create: `src/components/dashboard/DeadStockTable.tsx`

- [ ] **Step 1: Write the component, reusing `table-controls.tsx` and `csv.ts` from PR #13**

```tsx
"use client";

import { useMemo, useState } from "react";
import { formatCurrency, cn } from "@/lib/utils";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { FilterChip, SortableHeader } from "./table-controls";
import type { DeadStockProduct } from "@/lib/analytics/dead-stock";
import { PackageX, Download, Search } from "lucide-react";

type SortKey = "name" | "category" | "stockQty" | "investedCapital" | "retailValue" | "rotationDays" | "suggestedPrice";

interface Props {
  products: DeadStockProduct[];
  discountPct: number;
}

export function DeadStockTable({ products, discountPct }: Props) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("investedCapital");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category ?? "Sin categoría"));
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = products;
    if (categoryFilter !== "all") {
      out = out.filter((p) => (p.category ?? "Sin categoría") === categoryFilter);
    }
    if (q) out = out.filter((p) => p.name.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      if (sortKey === "name" || sortKey === "category") {
        const av = sortKey === "category" ? (a.category ?? "Sin categoría") : a.name;
        const bv = sortKey === "category" ? (b.category ?? "Sin categoría") : b.name;
        return av.localeCompare(bv) * dir;
      }
      if (sortKey === "suggestedPrice") {
        return (a.salePrice * (1 - discountPct / 100) - b.salePrice * (1 - discountPct / 100)) * dir;
      }
      return (a[sortKey] - b[sortKey]) * dir;
    });
  }, [products, query, categoryFilter, sortKey, sortDir, discountPct]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function handleExport() {
    const csv = buildCsv(filtered, [
      { header: "Producto", value: (p) => p.name },
      { header: "Categoría", value: (p) => p.category ?? "Sin categoría" },
      { header: "Stock", value: (p) => Math.round(p.stockQty) },
      { header: "Días sin venta", value: (p) => p.rotationDays },
      { header: "Capital invertido", value: (p) => Math.round(p.investedCapital) },
      { header: "Valor retail", value: (p) => Math.round(p.retailValue) },
      { header: `Precio liquidación (${discountPct}% off)`, value: (p) => Math.round(p.salePrice * (1 - discountPct / 100)) },
    ]);
    downloadCsv(`capital-muerto-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <PackageX className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Productos sin rotación</h3>
        <span className="text-xs text-muted-foreground">{filtered.length} de {products.length}</span>
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary transition-colors"
          title="Exportar a CSV"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto…"
            className="w-full rounded-lg border border-border bg-input pl-8 pr-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip label="Todas" active={categoryFilter === "all"} onClick={() => setCategoryFilter("all")} />
          {categories.map((c) => (
            <FilterChip key={c} label={c} active={categoryFilter === c} onClick={() => setCategoryFilter(c)} />
          ))}
        </div>
      </div>

      <div className="overflow-auto max-h-[560px] rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-secondary/95 backdrop-blur">
            <tr className="border-b border-border text-muted-foreground">
              <SortableHeader label="Producto" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" />
              <SortableHeader label="Categoría" active={sortKey === "category"} dir={sortDir} onClick={() => toggleSort("category")} align="left" />
              <SortableHeader label="Stock" active={sortKey === "stockQty"} dir={sortDir} onClick={() => toggleSort("stockQty")} />
              <SortableHeader label="Días sin venta" active={sortKey === "rotationDays"} dir={sortDir} onClick={() => toggleSort("rotationDays")} />
              <SortableHeader label="Capital invertido" active={sortKey === "investedCapital"} dir={sortDir} onClick={() => toggleSort("investedCapital")} />
              <SortableHeader label="Valor retail" active={sortKey === "retailValue"} dir={sortDir} onClick={() => toggleSort("retailValue")} />
              <SortableHeader label={`Precio liquid. (${discountPct}%)`} active={sortKey === "suggestedPrice"} dir={sortDir} onClick={() => toggleSort("suggestedPrice")} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted-foreground">Sin resultados para este filtro.</td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                  <td className="py-2 px-3 font-medium max-w-64 truncate">{p.name}</td>
                  <td className="py-2 px-3 text-muted-foreground">{p.category ?? "Sin categoría"}</td>
                  <td className="py-2 px-3 text-right">{p.stockQty.toFixed(0)}</td>
                  <td className="py-2 px-3 text-right text-warning font-medium">{p.rotationDays}d</td>
                  <td className="py-2 px-3 text-right font-medium">{formatCurrency(p.investedCapital)}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{formatCurrency(p.retailValue)}</td>
                  <td className="py-2 px-3 text-right font-semibold text-primary">
                    {formatCurrency(p.salePrice * (1 - discountPct / 100))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/DeadStockTable.tsx
git commit -m "feat(liquidacion): tabla completa de capital muerto con orden/filtro/export"
```

---

### Task 7: `LiquidationWorkspace` orchestrator

**Files:**
- Create: `src/components/dashboard/LiquidationWorkspace.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { DiscountScenarioCalculator } from "./DiscountScenarioCalculator";
import { DeadStockTable } from "./DeadStockTable";
import type { DeadStockProduct } from "@/lib/analytics/dead-stock";

interface Props {
  products: DeadStockProduct[];
}

export function LiquidationWorkspace({ products }: Props) {
  const [discountPct, setDiscountPct] = useState(30);

  return (
    <div className="space-y-6">
      <DiscountScenarioCalculator products={products} discountPct={discountPct} onChangeDiscount={setDiscountPct} />
      <DeadStockTable products={products} discountPct={discountPct} />
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/LiquidationWorkspace.tsx
git commit -m "feat(liquidacion): orquestador cliente que comparte el % de descuento"
```

---

### Task 8: Nav entry

**Files:**
- Modify: `src/components/layout/nav-config.tsx`

- [ ] **Step 1: Add the `PackageX` import and the new nav item after `/compras`**

Current content of the import block and `navItems` array (for reference — this is what exists before the edit):

```tsx
import {
  LayoutDashboard,
  TrendingUp,
  Package,
  DollarSign,
  MessageSquare,
  Tags,
  Wallet,
  BarChart3,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";

export const navItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Resumen", icon: LayoutDashboard },
  { href: "/ventas", label: "Ventas", icon: TrendingUp },
  { href: "/inventario", label: "Inventario", icon: Package },
  { href: "/categorias", label: "Categorías", icon: Tags },
  { href: "/abc", label: "ABC / Pareto", icon: BarChart3 },
  { href: "/financiero", label: "Financiero", icon: DollarSign },
  { href: "/presupuestos", label: "Presupuestos", icon: Wallet },
  { href: "/compras", label: "Compras", icon: ShoppingBag },
  { href: "/campanas", label: "Campañas", icon: MessageSquare },
];
```

Replace it with:

```tsx
import {
  LayoutDashboard,
  TrendingUp,
  Package,
  DollarSign,
  MessageSquare,
  Tags,
  Wallet,
  BarChart3,
  ShoppingBag,
  PackageX,
  type LucideIcon,
} from "lucide-react";

export const navItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Resumen", icon: LayoutDashboard },
  { href: "/ventas", label: "Ventas", icon: TrendingUp },
  { href: "/inventario", label: "Inventario", icon: Package },
  { href: "/categorias", label: "Categorías", icon: Tags },
  { href: "/abc", label: "ABC / Pareto", icon: BarChart3 },
  { href: "/financiero", label: "Financiero", icon: DollarSign },
  { href: "/presupuestos", label: "Presupuestos", icon: Wallet },
  { href: "/compras", label: "Compras", icon: ShoppingBag },
  { href: "/liquidacion", label: "Liquidación", icon: PackageX },
  { href: "/campanas", label: "Campañas", icon: MessageSquare },
];
```

(Leave the rest of the file — the `BrandMark` component below — untouched.)

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/nav-config.tsx
git commit -m "feat(liquidacion): agregar Liquidación al menú de navegación"
```

---

### Task 9: The page itself

**Files:**
- Create: `src/app/(dashboard)/liquidacion/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
export const dynamic = "force-dynamic";

import { getDeadStockAnalysis, getLiquidationGoal } from "@/lib/analytics/dead-stock";
import { LiquidationGoalEditor } from "@/components/dashboard/LiquidationGoalEditor";
import { LiquidationWorkspace } from "@/components/dashboard/LiquidationWorkspace";
import { formatCurrency, cn } from "@/lib/utils";
import { PackageX, AlertTriangle } from "lucide-react";

export default async function LiquidacionPage() {
  const analysis = await getDeadStockAnalysis().catch(() => null);

  if (!analysis || analysis.products.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Plan de Liquidación</h1>
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <PackageX className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Sin capital muerto detectado — todo tu inventario rota bien 👍</p>
        </div>
      </div>
    );
  }

  const goal = await getLiquidationGoal(analysis.totalInvestedCapital).catch(() => ({
    goalAmount: 0,
    baseline: 0,
    updatedAt: null,
    currentDeadStock: analysis.totalInvestedCapital,
  }));

  const severity = analysis.deadStockPctOfInventory > 50 ? "destructive" : analysis.deadStockPctOfInventory > 25 ? "warning" : "primary";
  const tone = {
    destructive: { text: "text-destructive", bg: "bg-destructive/5", border: "border-destructive/40" },
    warning: { text: "text-warning", bg: "bg-warning/5", border: "border-warning/40" },
    primary: { text: "text-primary", bg: "bg-primary/5", border: "border-primary/40" },
  }[severity];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Plan de Liquidación de Capital Muerto</h1>

      <div className={cn("rounded-xl border p-5", tone.border, tone.bg)}>
        <div className="flex items-start gap-3">
          <AlertTriangle className={cn("h-6 w-6 mt-0.5 shrink-0", tone.text)} />
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Capital inmovilizado</p>
            <p className={cn("text-3xl font-bold", tone.text)}>{formatCurrency(analysis.totalInvestedCapital)}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              El <span className={cn("font-semibold", tone.text)}>{analysis.deadStockPctOfInventory.toFixed(0)}%</span> de tu inventario total
              ({formatCurrency(analysis.totalInventoryValue)}) no se ha vendido en más de 30 días.
              Valor retail si se vendiera a precio normal: {formatCurrency(analysis.totalRetailValue)}.
            </p>
          </div>
        </div>
      </div>

      <LiquidationGoalEditor
        goalAmount={goal.goalAmount}
        baseline={goal.baseline}
        currentDeadStock={goal.currentDeadStock}
        updatedAt={goal.updatedAt}
      />

      <LiquidationWorkspace products={analysis.products} />

      {analysis.byCategory.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
          <h3 className="text-sm font-semibold">Capital muerto por categoría</h3>
          <div className="space-y-2">
            {analysis.byCategory.map((c) => {
              const maxVal = analysis.byCategory[0].investedCapital;
              const widthPct = maxVal > 0 ? (c.investedCapital / maxVal) * 100 : 0;
              return (
                <div key={c.category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{c.category} <span className="text-muted-foreground">({c.productCount})</span></span>
                    <span className="font-semibold">{formatCurrency(c.investedCapital)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary/40 overflow-hidden">
                    <div className="h-full bg-destructive/50 rounded-full" style={{ width: `${widthPct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/liquidacion/page.tsx
git commit -m "feat(liquidacion): página /liquidacion — ensamblado completo"
```

---

### Task 10: Full build + live verification

**Files:** none (verification only)

- [ ] **Step 1: Full production build**

Run: `npm run build`
Expected: build completes with no errors; `/liquidacion` appears in the route list output (as `ƒ /liquidacion`, dynamic — same pattern as `/inventario`, `/compras`, etc.).

- [ ] **Step 2: Start the dev server via the preview tool**

Use `preview_start` with the existing `utilia-dev` config in `.claude/launch.json` (already present from prior PRs — no new config needed).

- [ ] **Step 3: Log in and navigate to `/liquidacion`**

Credentials: `admin@utilia.co` / `utilia2026!` (from `prisma/seed.ts`). Navigate (click the new "Liquidación" sidebar link, not a raw `href` assignment — direct `window.location.href` navigation via `preview_eval` has been flaky this session; clicking the actual `<a>` via `preview_click` on `a[href="/liquidacion"]` has worked reliably).

- [ ] **Step 4: Verify the verdict banner and goal card render with real numbers**

Take a screenshot. Confirm: the top banner shows a $ figure and a %, the goal card shows "Sin meta fijada" (no goal set yet, since this is the first time).

- [ ] **Step 5: Set a goal and verify progress renders**

Click the pencil icon on the goal card, type a value (e.g. `3000000`), click the checkmark. Confirm the toast says "Meta actualizada" and the card now shows a progress bar and a `$0 de $3.000.000 (0%)` state (0% expected immediately after setting a fresh goal, since baseline == current dead stock at that instant).

- [ ] **Step 6: Verify the discount calculator**

Click each of the 20%/30%/50% preset buttons in turn; confirm the "Recuperas con X% off" figure changes each time and the active button gets the highlighted style. Try "Otro %" with a custom value (e.g. `40`) and confirm it applies and updates both the calculator numbers and the table's "Precio liquid." column header/values.

- [ ] **Step 7: Verify the table — search, category filter, sort, export**

Type a partial product name into the search box and confirm the row count shrinks. Click a category chip and confirm only that category's rows show. Click a sortable column header (e.g. "Capital invertido") and confirm the sort direction arrow toggles and rows reorder. Click "Exportar CSV" and confirm no console/server errors follow (same check used for every table this session).

- [ ] **Step 8: Check for errors**

Run `preview_console_logs` (level: error) and `preview_logs` (level: error) on the running server. Expected: no console logs, no server errors, in both cases.

- [ ] **Step 9: Mobile check**

Resize the preview to the `mobile` preset. Screenshot the page. Confirm the discount buttons and filter chips wrap without overflowing, and the table has its own horizontal scroll (same pattern already used by every other table in the app — no new mobile-card view is required here since the spec didn't call for one, unlike the Compras fix in PR #14).

- [ ] **Step 10: Stop the preview server**

Use `preview_stop`.

- [ ] **Step 11: Push and open the PR**

```bash
git push -u origin feat/liquidacion-capital-muerto
gh pr create --base main --title "feat(liquidacion): plan de liquidación de capital muerto" --body "..."
```
(Write the actual PR body summarizing what changed, referencing the spec file, when this step is executed — do not template it here.)

---

## Self-Review Notes (completed during authoring of this plan)

- **Spec coverage:** all 5 spec sections have a corresponding task — data model (Task 1), goal mechanic (Task 2–4), discount calculator (Task 5), full table (Task 6), page assembly + nav (Tasks 7–9). The one deliberate scope simplification (calculator ignores the table's category filter) is called out explicitly in the File Structure section above, not silently dropped.
- **Type consistency checked:** `DeadStockProduct`, `DeadStockByCategory`, `DeadStockAnalysis`, `LiquidationGoal` are defined once in Task 1–2 and referenced identically (same field names) in Tasks 5, 6, 7, 9 — no renamed fields across tasks.
- **No placeholders:** every step has complete, runnable code; the only non-literal step is Task 10 Step 11's PR body, which is explicitly marked as written at execution time (a PR description cannot be authored before the diff exists).
