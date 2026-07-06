# Selector de Periodo Global Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compartir un selector de mes/año entre Ventas, Financiero y Presupuestos (persistente al navegar entre las 3), resolviendo el punto #10 del informe de auditoría, según el spec aprobado en `docs/superpowers/specs/2026-07-05-selector-periodo-global-design.md`.

**Architecture:** Una cookie (`selected_period`) es la fuente de verdad compartida, leída server-side por una función común (`getSelectedPeriod()`) que usan tanto el layout compartido como las 3 páginas. Un componente cliente (`PeriodSelector`) en el header del layout muestra flechas de navegación y solo se renderiza en las 3 rutas relevantes; al cambiar de mes actualiza la cookie y, en Presupuestos, también la URL (para preservar sus links compartibles existentes). Breakeven, Flujo de Caja, Patrón Semanal y Top 10 por velocidad quedan explícitamente fuera de este cambio (conceptos de "hoy"/"ahora" o snapshots sin histórico, no periodos navegables).

**Tech Stack:** Next.js 15 App Router (Server Components + Server Actions + `cookies()` de `next/headers`, ambos async en esta versión — ya usado así en el resto del código, ej. `await searchParams`), React Client Components (`useTransition`, `usePathname`, `useSearchParams`, `useRouter` de `next/navigation`), Prisma. No hay test runner en este repo — verificación por `npx tsc --noEmit` en cada tarea, `npm run build` + verificación en navegador al final (mismo patrón usado en todo el trabajo previo de este proyecto).

---

## File Structure

| File | Action | Responsibilidad |
|---|---|---|
| `src/lib/period.ts` | Create | `getSelectedPeriod()` — única fuente de verdad server-side (URL > cookie > mes real) |
| `src/app/(dashboard)/period-actions.ts` | Create | Server action `setSelectedPeriod(month, year)` — solo escribe la cookie |
| `src/components/layout/PeriodSelector.tsx` | Create | Client component: flechas + label + botón "Hoy", condicionado a 3 rutas |
| `src/app/(dashboard)/layout.tsx` | Modify | Resuelve el periodo y renderiza `<PeriodSelector />` en el header |
| `src/lib/analytics/revenue-waterfall.ts` | Modify | `getRevenueWaterfall(year, month)` — antes sin parámetros, ahora acotado al mes |
| `src/lib/analytics/month-compare.ts` | Modify | `getMonthComparison(year, month)` — antes siempre "hoy"; mes cerrado compara completo, no MTD |
| `src/components/dashboard/WaterfallCard.tsx` | Modify | Nota opcional cuando el desglose por categoría no coincide con el mes mostrado |
| `src/app/(dashboard)/ventas/page.tsx` | Modify | Usa el periodo seleccionado para KPIs/gráfico; etiquetas dinámicas |
| `src/app/(dashboard)/financiero/page.tsx` | Modify | Usa el periodo seleccionado; nota "esto es de hoy" en Breakeven/CashFlow cuando no es el mes actual |
| `src/components/dashboard/MonthCompare.tsx` | Modify | Recibe `isCurrentPeriod`, cambia etiquetas "MTD" → "mes completo" |
| `src/app/(dashboard)/presupuestos/page.tsx` | Modify | Usa `getSelectedPeriod(params)` en vez de su fallback inline |

---

### Task 1: Función compartida `getSelectedPeriod()`

**Files:**
- Create: `src/lib/period.ts`

- [ ] **Step 1: Escribir el archivo**

```ts
import { cookies } from "next/headers";
import { colombiaYearMonthDay } from "./timezone";

const COOKIE_NAME = "selected_period";

export interface SelectedPeriod {
  month: number;
  year: number;
  isCurrentPeriod: boolean; // true si coincide con el mes real de hoy
  realMonth: number;        // mes real de hoy (Colombia), para el botón "Hoy"
  realYear: number;
}

export interface PeriodUrlOverride {
  month?: string;
  year?: string;
}

/**
 * Única fuente de verdad server-side sobre "qué mes estamos viendo".
 * Prioridad: parámetro de URL explícito (solo Presupuestos lo usa) > cookie
 * compartida > mes real de hoy. La usan el layout y las 3 páginas con
 * navegación de mes (Ventas, Financiero, Presupuestos).
 */
export async function getSelectedPeriod(urlOverride?: PeriodUrlOverride): Promise<SelectedPeriod> {
  const { month: realMonth, year: realYear } = colombiaYearMonthDay();

  let month = realMonth;
  let year = realYear;

  const urlMonth = urlOverride?.month ? Number(urlOverride.month) : null;
  const urlYear = urlOverride?.year ? Number(urlOverride.year) : null;

  if (urlMonth && urlYear) {
    month = urlMonth;
    year = urlYear;
  } else {
    const store = await cookies();
    const raw = store.get(COOKIE_NAME)?.value;
    if (raw) {
      const [y, m] = raw.split("-").map(Number);
      if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
        year = y;
        month = m;
      }
    }
  }

  return {
    month,
    year,
    isCurrentPeriod: month === realMonth && year === realYear,
    realMonth,
    realYear,
  };
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/period.ts
git commit -m "feat(periodo): getSelectedPeriod() — fuente de verdad compartida del mes/año"
```

---

### Task 2: Server action para guardar el periodo

**Files:**
- Create: `src/app/(dashboard)/period-actions.ts`

- [ ] **Step 1: Escribir el archivo**

```ts
"use server";

import { cookies } from "next/headers";

const COOKIE_NAME = "selected_period";

export async function setSelectedPeriod(month: number, year: number): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, `${year}-${String(month).padStart(2, "0")}`, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 año
  });
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/period-actions.ts"
git commit -m "feat(periodo): server action para guardar el mes seleccionado en cookie"
```

---

### Task 3: Componente `PeriodSelector`

**Files:**
- Create: `src/components/layout/PeriodSelector.tsx`

- [ ] **Step 1: Escribir el archivo**

```tsx
"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { setSelectedPeriod } from "@/app/(dashboard)/period-actions";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const ALLOWED_PATHS = new Set(["/ventas", "/financiero", "/presupuestos"]);

interface Props {
  month: number;
  year: number;
  isCurrentPeriod: boolean;
  realMonth: number;
  realYear: number;
}

export function PeriodSelector({ month, year, isCurrentPeriod, realMonth, realYear }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  if (!ALLOWED_PATHS.has(pathname)) return null;

  // En Presupuestos, un ?month=&year= explícito en la URL le gana a la
  // cookie (preserva links compartibles y el flujo de "Clonar a otro mes",
  // que navega con sus propios parámetros sin pasar por este componente).
  const urlMonth = pathname === "/presupuestos" ? Number(searchParams.get("month")) : null;
  const urlYear = pathname === "/presupuestos" ? Number(searchParams.get("year")) : null;
  const effectiveMonth = urlMonth && urlYear ? urlMonth : month;
  const effectiveYear = urlMonth && urlYear ? urlYear : year;
  const effectiveIsCurrent = effectiveMonth === realMonth && effectiveYear === realYear;

  function go(newMonth: number, newYear: number) {
    startTransition(async () => {
      await setSelectedPeriod(newMonth, newYear);
      if (pathname === "/presupuestos") {
        router.push(`/presupuestos?month=${newMonth}&year=${newYear}`);
      } else {
        router.refresh();
      }
    });
  }

  function prev() {
    const d = new Date(effectiveYear, effectiveMonth - 2, 1);
    go(d.getMonth() + 1, d.getFullYear());
  }

  function next() {
    if (effectiveIsCurrent) return;
    const d = new Date(effectiveYear, effectiveMonth, 1);
    go(d.getMonth() + 1, d.getFullYear());
  }

  function today() {
    go(realMonth, realYear);
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground mr-0.5" />
      <button
        onClick={prev}
        disabled={pending}
        title="Mes anterior"
        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50 transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="font-medium min-w-[92px] text-center">
        {MONTHS[effectiveMonth - 1]} {effectiveYear}
      </span>
      <button
        onClick={next}
        disabled={pending || effectiveIsCurrent}
        title="Mes siguiente"
        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30 transition-colors"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      {!effectiveIsCurrent && (
        <button
          onClick={today}
          disabled={pending}
          className="ml-1 rounded px-1.5 py-0.5 text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors font-medium"
        >
          Hoy
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/PeriodSelector.tsx
git commit -m "feat(periodo): componente PeriodSelector con flechas y botón Hoy"
```

---

### Task 4: Integrar `PeriodSelector` en el layout compartido

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Reemplazar el contenido del archivo**

Contenido actual completo (para referencia — así se ve antes del cambio):

```tsx
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNavProvider, MobileNavTrigger } from "@/components/layout/MobileNav";
import { SyncButton } from "@/components/layout/SyncButton";
import { prisma } from "@/lib/prisma";

async function getSyncStatus() {
  try {
    const state = await prisma.syncState.findFirst({
      where: { entity: "pos_order" },
      select: { lastSyncAt: true, status: true },
    });
    return state;
  } catch {
    return null;
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const syncState = await getSyncStatus();
  const lastSyncLabel = syncState?.lastSyncAt
    ? new Date(syncState.lastSyncAt).toLocaleString("es-CO", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Bogota",
      })
    : null;

  return (
    <MobileNavProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-background">
          <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3">
              <MobileNavTrigger />
              <div className="flex items-center gap-3">
                {lastSyncLabel && (
                  <span className="text-xs text-muted-foreground">
                    Último sync: <span className="text-foreground">{lastSyncLabel}</span>
                  </span>
                )}
                <SyncButton />
              </div>
            </div>
          </header>
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>
    </MobileNavProvider>
  );
}
```

Reemplazar por:

```tsx
import { Suspense } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNavProvider, MobileNavTrigger } from "@/components/layout/MobileNav";
import { SyncButton } from "@/components/layout/SyncButton";
import { PeriodSelector } from "@/components/layout/PeriodSelector";
import { getSelectedPeriod } from "@/lib/period";
import { prisma } from "@/lib/prisma";

async function getSyncStatus() {
  try {
    const state = await prisma.syncState.findFirst({
      where: { entity: "pos_order" },
      select: { lastSyncAt: true, status: true },
    });
    return state;
  } catch {
    return null;
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [syncState, period] = await Promise.all([getSyncStatus(), getSelectedPeriod()]);
  const lastSyncLabel = syncState?.lastSyncAt
    ? new Date(syncState.lastSyncAt).toLocaleString("es-CO", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Bogota",
      })
    : null;

  return (
    <MobileNavProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-background">
          <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3">
              <MobileNavTrigger />
              <Suspense fallback={null}>
                <PeriodSelector
                  month={period.month}
                  year={period.year}
                  isCurrentPeriod={period.isCurrentPeriod}
                  realMonth={period.realMonth}
                  realYear={period.realYear}
                />
              </Suspense>
              <div className="flex items-center gap-3">
                {lastSyncLabel && (
                  <span className="text-xs text-muted-foreground">
                    Último sync: <span className="text-foreground">{lastSyncLabel}</span>
                  </span>
                )}
                <SyncButton />
              </div>
            </div>
          </header>
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>
    </MobileNavProvider>
  );
}
```

(`<PeriodSelector>` usa `useSearchParams()`, que en Next.js App Router requiere estar dentro de un `<Suspense>` — de lo contrario el build advierte o fuerza deopt de la ruta a client-only.)

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/layout.tsx"
git commit -m "feat(periodo): integrar PeriodSelector en el header compartido"
```

---

### Task 5: `getRevenueWaterfall(year, month)` acotado al mes

**Files:**
- Modify: `src/lib/analytics/revenue-waterfall.ts`

- [ ] **Step 1: Reemplazar la firma y el query de snapshots**

Cambiar:

```ts
export async function getRevenueWaterfall(): Promise<RevenueWaterfall> {
  const [snapshots, catRows] = await Promise.all([
    prisma.financialSnapshot.findMany({
      where: { date: { gte: colombiaStartOfMonth() } },
      select: { totalRevenue: true, totalCost: true, fixedExpenses: true },
    }),
```

por:

```ts
export async function getRevenueWaterfall(year: number, month: number): Promise<RevenueWaterfall> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const [snapshots, catRows] = await Promise.all([
    prisma.financialSnapshot.findMany({
      where: { date: { gte: start, lt: end } },
      select: { totalRevenue: true, totalCost: true, fixedExpenses: true },
    }),
```

El resto de la función (query de `catRows`, cálculos de totales y categorías) no cambia.

- [ ] **Step 2: Quitar el import ahora sin uso**

`colombiaStartOfMonth` ya no se usa en este archivo — cambiar:

```ts
import { colombiaStartOfMonth } from "@/lib/timezone";
```

por: eliminar esa línea (el archivo no necesita ningún import de `@/lib/timezone` tras este cambio).

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/analytics/revenue-waterfall.ts
git commit -m "feat(periodo): getRevenueWaterfall acepta year/month en vez de asumir el mes actual"
```

---

### Task 6: `getMonthComparison(year, month)` — mes cerrado compara completo

**Files:**
- Modify: `src/lib/analytics/month-compare.ts`

- [ ] **Step 1: Reemplazar `getMonthComparison`**

Cambiar (función completa, al final del archivo):

```ts
export async function getMonthComparison(): Promise<MonthComparison> {
  const { year: curYear, month: curMonth, day: curDay } = colombiaYearMonthDay();
  const prevDate = new Date(curYear, curMonth - 2, 1);
  const prevYear = prevDate.getFullYear();
  const prevMonth = prevDate.getMonth() + 1;

  const [current, previous, currentMTD, previousMTD] = await Promise.all([
    aggregateMonth(curYear, curMonth),
    aggregateMonth(prevYear, prevMonth),
    aggregateMonth(curYear, curMonth, curDay),
    aggregateMonth(prevYear, prevMonth, curDay),
  ]);

  return {
    current,
    previous,
    currentMTD,
    previousMTD,
    deltas: {
      revenue: pctChange(currentMTD.totalRevenue, previousMTD.totalRevenue),
      transactions: pctChange(currentMTD.totalTransactions, previousMTD.totalTransactions),
      avgTicket: pctChange(currentMTD.avgTicket, previousMTD.avgTicket),
      netProfit: pctChange(currentMTD.netProfit, previousMTD.netProfit),
      margin: currentMTD.netMarginPct - previousMTD.netMarginPct,
    },
  };
}
```

por:

```ts
/**
 * Compara el mes indicado (`year`, `month`) contra el mes anterior a ese.
 * Si el mes indicado ES el mes real en curso, la comparación "MTD" cap al día
 * de hoy (mismos N días transcurridos en ambos meses — justa para un mes que
 * aún no cierra). Si es un mes pasado ya cerrado, capar al día de hoy no
 * tiene sentido (ej. comparar junio solo hasta el "día 5" porque hoy es 5 de
 * julio sería arbitrario) — en ese caso `currentMTD`/`previousMTD` son los
 * meses completos, iguales a `current`/`previous`.
 */
export async function getMonthComparison(year: number, month: number): Promise<MonthComparison> {
  const { year: realYear, month: realMonth, day: realDay } = colombiaYearMonthDay();
  const isRealCurrentMonth = year === realYear && month === realMonth;
  const dayCap = isRealCurrentMonth ? realDay : undefined;

  const prevDate = new Date(year, month - 2, 1);
  const prevYear = prevDate.getFullYear();
  const prevMonth = prevDate.getMonth() + 1;

  const [current, previous, currentMTD, previousMTD] = await Promise.all([
    aggregateMonth(year, month),
    aggregateMonth(prevYear, prevMonth),
    aggregateMonth(year, month, dayCap),
    aggregateMonth(prevYear, prevMonth, dayCap),
  ]);

  return {
    current,
    previous,
    currentMTD,
    previousMTD,
    deltas: {
      revenue: pctChange(currentMTD.totalRevenue, previousMTD.totalRevenue),
      transactions: pctChange(currentMTD.totalTransactions, previousMTD.totalTransactions),
      avgTicket: pctChange(currentMTD.avgTicket, previousMTD.avgTicket),
      netProfit: pctChange(currentMTD.netProfit, previousMTD.netProfit),
      margin: currentMTD.netMarginPct - previousMTD.netMarginPct,
    },
  };
}
```

`aggregateMonth` no cambia — ya acepta `dayCap?: number` opcional, y pasar `undefined` explícitamente ya produce "mes completo" (mismo camino que usan `current`/`previous`, que nunca pasaron `dayCap`).

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin output. (Este cambio romperá temporalmente la build completa porque `financiero/page.tsx` todavía llama a `getMonthComparison()` sin argumentos — eso se corrige en la Tarea 9. Un error de tipo aquí en este punto del plan, señalando la llamada en `financiero/page.tsx`, es esperado; confirmar que el error apunta exactamente a esa línea y no a otra parte.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/month-compare.ts
git commit -m "feat(periodo): getMonthComparison acepta year/month; mes cerrado compara completo"
```

---

### Task 7: Nota opcional en `WaterfallCard` para el desglose por categoría

**Files:**
- Modify: `src/components/dashboard/WaterfallCard.tsx`

**Contexto para este cambio:** el desglose "Reposición por categoría" de esta tarjeta se calcula desde `avgDailySales7d` de `ProductInsight` (velocidad de venta *actual*, sin histórico) — a diferencia de los 4 totales de arriba (Ingresos/Reposición/Gastos fijos/Utilidad), que sí vienen de `FinancialSnapshot` y por lo tanto sí reflejan el mes históricamente correcto una vez que `getRevenueWaterfall` acepta `year`/`month` (Tarea 5). Cuando se esté viendo un mes distinto al actual, el desglose por categoría seguiría mostrando la velocidad de HOY, no la de ese mes — hay que aclararlo con una nota, no dejarlo como si fuera dato histórico real.

- [ ] **Step 1: Añadir un prop opcional `categoryBreakdownNote`**

Cambiar la firma:

```tsx
interface Props {
  data: RevenueWaterfall;
}

export function WaterfallCard({ data }: Props) {
```

por:

```tsx
interface Props {
  data: RevenueWaterfall;
  categoryBreakdownNote?: string;
}

export function WaterfallCard({ data, categoryBreakdownNote }: Props) {
```

- [ ] **Step 2: Renderizar la nota sobre el desglose por categoría**

Ubicar este bloque (el encabezado de la sección "Reposición por categoría"):

```tsx
      {/* Desglose: reposición por categoría */}
      <div className="space-y-2 pt-2 border-t border-border">
        <div className="flex items-center gap-2">
          <ArrowDown className="h-3.5 w-3.5 text-warning" />
          <p className="text-xs font-semibold">Reposición por categoría</p>
          <span className="ml-auto text-xs text-muted-foreground">{formatCurrency(totalCogs)} total</span>
        </div>
```

y agregar la nota justo después del `</div>` de esa fila de encabezado (antes de `<div className="space-y-1.5">` que renderiza las filas de categoría):

```tsx
      {/* Desglose: reposición por categoría */}
      <div className="space-y-2 pt-2 border-t border-border">
        <div className="flex items-center gap-2">
          <ArrowDown className="h-3.5 w-3.5 text-warning" />
          <p className="text-xs font-semibold">Reposición por categoría</p>
          <span className="ml-auto text-xs text-muted-foreground">{formatCurrency(totalCogs)} total</span>
        </div>
        {categoryBreakdownNote && (
          <p className="text-xs text-muted-foreground italic">{categoryBreakdownNote}</p>
        )}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin output.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/WaterfallCard.tsx
git commit -m "feat(periodo): nota opcional en WaterfallCard cuando el desglose no es del mes mostrado"
```

---

### Task 8: Ventas usa el periodo seleccionado

**Files:**
- Modify: `src/app/(dashboard)/ventas/page.tsx`

- [ ] **Step 1: Reemplazar los imports**

Cambiar:

```tsx
import { colombiaStartOfMonth } from "@/lib/timezone";
```

por:

```tsx
import { getSelectedPeriod } from "@/lib/period";
```

- [ ] **Step 2: Dar parámetros a `getSalesData`**

Cambiar:

```tsx
async function getSalesData() {
  const snapshots = await prisma.financialSnapshot.findMany({
    where: { date: { gte: colombiaStartOfMonth() } },
    orderBy: { date: "asc" },
  });
```

por:

```tsx
const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

async function getSalesData(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const snapshots = await prisma.financialSnapshot.findMany({
    where: { date: { gte: start, lt: end } },
    orderBy: { date: "asc" },
  });
```

(Coloca la constante `MONTHS` justo antes de `async function getSalesData`, a nivel de módulo.)

- [ ] **Step 3: Resolver el periodo y pasarlo a `getSalesData`, ajustar etiquetas**

Cambiar:

```tsx
export default async function VentasPage() {
  const [salesData, weeklyPattern] = await Promise.all([
    getSalesData().catch(() => ({ dailyData: [] as Awaited<ReturnType<typeof getSalesData>>["dailyData"], topProducts: [] as Awaited<ReturnType<typeof getSalesData>>["topProducts"], activeProductCount: 0, totalRevenue30d: 0, totalTransactions: 0, avgTicket: 0 })),
    getWeeklyPattern(60).catch(() => []),
  ]);
  const { dailyData, topProducts, activeProductCount, totalRevenue30d, totalTransactions, avgTicket } = salesData;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Analítica de Ventas</h1>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KPICard title="Ingresos mes actual" value={formatCurrency(totalRevenue30d)} icon={DollarSign} variant="success" />
        <KPICard title="Transacciones mes" value={String(totalTransactions)} icon={ShoppingCart} />
        <KPICard title="Ticket Promedio" value={formatCurrency(avgTicket)} icon={TrendingUp} />
        <KPICard title="Productos Activos" value={String(activeProductCount)} subvalue="con ventas recientes" icon={Users} />
      </div>

      <SalesChart data={dailyData} title="Ventas Diarias — Mes Actual" />
```

por:

```tsx
export default async function VentasPage() {
  const { month, year, isCurrentPeriod } = await getSelectedPeriod();
  const [salesData, weeklyPattern] = await Promise.all([
    getSalesData(year, month).catch(() => ({ dailyData: [] as Awaited<ReturnType<typeof getSalesData>>["dailyData"], topProducts: [] as Awaited<ReturnType<typeof getSalesData>>["topProducts"], activeProductCount: 0, totalRevenue30d: 0, totalTransactions: 0, avgTicket: 0 })),
    getWeeklyPattern(60).catch(() => []),
  ]);
  const { dailyData, topProducts, activeProductCount, totalRevenue30d, totalTransactions, avgTicket } = salesData;
  const periodLabel = `${MONTHS[month - 1]} ${year}`;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Analítica de Ventas</h1>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KPICard title={isCurrentPeriod ? "Ingresos mes actual" : `Ingresos — ${periodLabel}`} value={formatCurrency(totalRevenue30d)} icon={DollarSign} variant="success" />
        <KPICard title={isCurrentPeriod ? "Transacciones mes" : `Transacciones — ${periodLabel}`} value={String(totalTransactions)} icon={ShoppingCart} />
        <KPICard title="Ticket Promedio" value={formatCurrency(avgTicket)} icon={TrendingUp} />
        <KPICard title="Productos Activos" value={String(activeProductCount)} subvalue="con ventas recientes" icon={Users} />
      </div>

      <SalesChart data={dailyData} title={isCurrentPeriod ? "Ventas Diarias — Mes Actual" : `Ventas Diarias — ${periodLabel}`} />
```

(El resto del archivo — `WeeklyPattern`, el bloque "Top 10 Productos por Velocidad de Venta" — no cambia: ambos son snapshots de velocidad actual sin histórico por mes, fuera de alcance según el spec.)

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/ventas/page.tsx"
git commit -m "feat(periodo): Ventas usa el mes seleccionado para KPIs y gráfico diario"
```

---

### Task 9: Financiero usa el periodo seleccionado

**Files:**
- Modify: `src/app/(dashboard)/financiero/page.tsx`

- [ ] **Step 1: Reemplazar imports**

Cambiar:

```tsx
import { colombiaStartOfMonth, colombiaYearMonthDay } from "@/lib/timezone";
```

por:

```tsx
import { getSelectedPeriod } from "@/lib/period";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
```

- [ ] **Step 2: Dar parámetros a `getFinancialData`**

Cambiar:

```tsx
async function getFinancialData() {
  const { year, month } = colombiaYearMonthDay();
  const [snapshots, budgets] = await Promise.all([
    prisma.financialSnapshot.findMany({ where: { date: { gte: colombiaStartOfMonth() } }, orderBy: { date: "asc" } }),
    prisma.expenseBudget.findMany({ where: { year, month } }),
  ]);
```

por:

```tsx
async function getFinancialData(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const [snapshots, budgets] = await Promise.all([
    prisma.financialSnapshot.findMany({ where: { date: { gte: start, lt: end } }, orderBy: { date: "asc" } }),
    prisma.expenseBudget.findMany({ where: { year, month } }),
  ]);
```

El resto de `getFinancialData` (cálculo de `totals`, `netMarginPct`, `chartData`, `projection`) no cambia — ya usa `year`/`month` de forma local, ahora vienen del parámetro en vez de `colombiaYearMonthDay()`.

- [ ] **Step 3: Resolver el periodo, pasarlo a las 3 funciones de análisis, gatear la proyección**

Cambiar:

```tsx
export default async function FinancieroPage() {
  const fallbackTotals = { revenue: 0, cost: 0, profit: 0, expenses: 0 };
  const [financial, monthCompare, breakeven, cashFlow, waterfall] = await Promise.all([
    getFinancialData().catch(() => ({ totals: fallbackTotals, netMarginPct: 0, chartData: [] as Awaited<ReturnType<typeof getFinancialData>>["chartData"], budgets: [] as Awaited<ReturnType<typeof getFinancialData>>["budgets"], projection: null as MonthEndProjection | null })),
    getMonthComparison().catch(() => null),
    getBreakevenAnalysis().catch(() => null),
    getCashFlowAnalysis().catch(() => null),
    getRevenueWaterfall().catch(() => null),
  ]);
  const { totals = fallbackTotals, netMarginPct, chartData, budgets, projection } = financial;

  // Los primeros días del mes, la utilidad MTD cruda casi siempre se ve en
  // pérdida (pocos días de ingresos contra gastos fijos ya prorrateados) sin
  // que nada esté mal. Con pocos días de historia, el veredicto responde
  // "a este ritmo, ¿cómo cerrarías?" en vez de juzgar sobre datos parciales.
  const useProjection = projection !== null && projection.lowConfidence && projection.daysElapsed > 0;
```

por:

```tsx
export default async function FinancieroPage() {
  const { month, year, isCurrentPeriod } = await getSelectedPeriod();
  const periodLabel = `${MONTHS[month - 1]} ${year}`;

  const fallbackTotals = { revenue: 0, cost: 0, profit: 0, expenses: 0 };
  const [financial, monthCompare, breakeven, cashFlow, waterfall] = await Promise.all([
    getFinancialData(year, month).catch(() => ({ totals: fallbackTotals, netMarginPct: 0, chartData: [] as Awaited<ReturnType<typeof getFinancialData>>["chartData"], budgets: [] as Awaited<ReturnType<typeof getFinancialData>>["budgets"], projection: null as MonthEndProjection | null })),
    getMonthComparison(year, month).catch(() => null),
    getBreakevenAnalysis().catch(() => null),
    getCashFlowAnalysis().catch(() => null),
    getRevenueWaterfall(year, month).catch(() => null),
  ]);
  const { totals = fallbackTotals, netMarginPct, chartData, budgets, projection } = financial;

  // Los primeros días del mes, la utilidad MTD cruda casi siempre se ve en
  // pérdida (pocos días de ingresos contra gastos fijos ya prorrateados) sin
  // que nada esté mal. Con pocos días de historia, el veredicto responde
  // "a este ritmo, ¿cómo cerrarías?" en vez de juzgar sobre datos parciales.
  // Solo aplica al mes real en curso — un mes pasado ya cerrado no se "proyecta".
  const useProjection = isCurrentPeriod && projection !== null && projection.lowConfidence && projection.daysElapsed > 0;
```

(`getBreakevenAnalysis()` y `getCashFlowAnalysis()` NO cambian — siguen sin parámetros, siempre "hoy"/rolling, según el spec.)

- [ ] **Step 4: Encabezado con el mes, nota en Breakeven/CashFlow, nota en Waterfall, título dinámico del gráfico y del bloque de presupuesto**

Cambiar:

```tsx
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Centro Financiero</h1>
```

por:

```tsx
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">
        Centro Financiero{!isCurrentPeriod && <span className="text-muted-foreground font-normal"> — {periodLabel}</span>}
      </h1>
```

Cambiar:

```tsx
      {waterfall && <WaterfallCard data={waterfall} />}

      {breakeven && <BreakevenCard data={breakeven} />}

      {cashFlow && <CashFlowCard data={cashFlow} />}

      {monthCompare && <MonthCompare data={monthCompare} />}

      <SalesChart data={chartData} title="Utilidad Diaria — Mes Actual" />
```

por:

```tsx
      {waterfall && (
        <WaterfallCard
          data={waterfall}
          categoryBreakdownNote={!isCurrentPeriod ? "Desglose por categoría basado en velocidad de venta actual, no en datos históricos de este mes." : undefined}
        />
      )}

      {breakeven && (
        <div className="space-y-2">
          {!isCurrentPeriod && (
            <p className="text-xs text-muted-foreground italic">Este punto de equilibrio es de hoy, no de {periodLabel}.</p>
          )}
          <BreakevenCard data={breakeven} />
        </div>
      )}

      {cashFlow && (
        <div className="space-y-2">
          {!isCurrentPeriod && (
            <p className="text-xs text-muted-foreground italic">Este flujo de caja es de ahora mismo, no de {periodLabel}.</p>
          )}
          <CashFlowCard data={cashFlow} />
        </div>
      )}

      {monthCompare && <MonthCompare data={monthCompare} isCurrentPeriod={isCurrentPeriod} />}

      <SalesChart data={chartData} title={isCurrentPeriod ? "Utilidad Diaria — Mes Actual" : `Utilidad Diaria — ${periodLabel}`} />
```

Cambiar:

```tsx
          <h3 className="text-sm font-semibold">Presupuesto por Categoría — Mes Actual</h3>
```

por:

```tsx
          <h3 className="text-sm font-semibold">Presupuesto por Categoría — {isCurrentPeriod ? "Mes Actual" : periodLabel}</h3>
```

- [ ] **Step 5: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: error de tipo esperado en este punto: `<MonthCompare data={monthCompare} isCurrentPeriod={isCurrentPeriod} />` fallará porque `MonthCompare` todavía no acepta ese prop — se corrige en la Tarea 10. Confirmar que el único error apunta a esa línea.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/financiero/page.tsx"
git commit -m "feat(periodo): Financiero usa el mes seleccionado; notas de 'hoy' en Breakeven/CashFlow"
```

---

### Task 10: `MonthCompare` distingue mes en curso vs. mes cerrado

**Files:**
- Modify: `src/components/dashboard/MonthCompare.tsx`

- [ ] **Step 1: Aceptar el prop `isCurrentPeriod` y ajustar etiquetas**

Cambiar:

```tsx
interface Props {
  data: MonthComparison;
}
```

por:

```tsx
interface Props {
  data: MonthComparison;
  isCurrentPeriod: boolean;
}
```

Cambiar:

```tsx
export function MonthCompare({ data }: Props) {
  const { currentMTD, previousMTD, current, previous, deltas } = data;
```

por:

```tsx
export function MonthCompare({ data, isCurrentPeriod }: Props) {
  const { currentMTD, previousMTD, current, previous, deltas } = data;
  const periodSuffix = isCurrentPeriod ? "MTD" : "del mes";
```

Cambiar:

```tsx
        <span className="text-xs text-muted-foreground">
          MTD: {currentMTD.daysWithData} días vs {previousMTD.daysWithData} días
        </span>
```

por:

```tsx
        <span className="text-xs text-muted-foreground">
          {isCurrentPeriod ? "MTD" : "Mes completo"}: {currentMTD.daysWithData} días vs {previousMTD.daysWithData} días
        </span>
```

Cambiar las 4 etiquetas de `MetricCompareCard`:

```tsx
        <MetricCompareCard
          label="Ingresos MTD"
          currentValue={formatCurrency(currentMTD.totalRevenue)}
          previousValue={formatCurrency(previousMTD.totalRevenue)}
          delta={deltas.revenue}
        />
        <MetricCompareCard
          label="Transacciones MTD"
          currentValue={currentMTD.totalTransactions.toLocaleString("es-CO")}
          previousValue={previousMTD.totalTransactions.toLocaleString("es-CO")}
          delta={deltas.transactions}
        />
        <MetricCompareCard
          label="Ticket Promedio MTD"
          currentValue={formatCurrency(currentMTD.avgTicket)}
          previousValue={formatCurrency(previousMTD.avgTicket)}
          delta={deltas.avgTicket}
        />
        <MetricCompareCard
          label="Utilidad Neta MTD"
          currentValue={formatCurrency(currentMTD.netProfit)}
          previousValue={formatCurrency(previousMTD.netProfit)}
          delta={deltas.netProfit}
          deltaOverride={netProfitDeltaOverride}
        />
```

por:

```tsx
        <MetricCompareCard
          label={`Ingresos ${periodSuffix}`}
          currentValue={formatCurrency(currentMTD.totalRevenue)}
          previousValue={formatCurrency(previousMTD.totalRevenue)}
          delta={deltas.revenue}
        />
        <MetricCompareCard
          label={`Transacciones ${periodSuffix}`}
          currentValue={currentMTD.totalTransactions.toLocaleString("es-CO")}
          previousValue={previousMTD.totalTransactions.toLocaleString("es-CO")}
          delta={deltas.transactions}
        />
        <MetricCompareCard
          label={`Ticket Promedio ${periodSuffix}`}
          currentValue={formatCurrency(currentMTD.avgTicket)}
          previousValue={formatCurrency(previousMTD.avgTicket)}
          delta={deltas.avgTicket}
        />
        <MetricCompareCard
          label={`Utilidad Neta ${periodSuffix}`}
          currentValue={formatCurrency(currentMTD.netProfit)}
          previousValue={formatCurrency(previousMTD.netProfit)}
          delta={deltas.netProfit}
          deltaOverride={netProfitDeltaOverride}
        />
```

(El resto del archivo — cálculo de `profitInLoss`/`netProfitDeltaOverride`, la sección "Mes anterior cerrado" — no cambia.)

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin output (esto también resuelve el error esperado de la Tarea 9, Step 5).

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/MonthCompare.tsx
git commit -m "feat(periodo): MonthCompare distingue mes en curso (MTD) vs. mes cerrado (completo)"
```

---

### Task 11: Presupuestos usa `getSelectedPeriod`

**Files:**
- Modify: `src/app/(dashboard)/presupuestos/page.tsx`

- [ ] **Step 1: Reemplazar el import y la resolución de mes/año**

Cambiar:

```tsx
import { colombiaYearMonthDay } from "@/lib/timezone";
import { recomputeMonthFixedExpenses } from "@/lib/snapshots";
```

por:

```tsx
import { getSelectedPeriod } from "@/lib/period";
import { recomputeMonthFixedExpenses } from "@/lib/snapshots";
```

Cambiar:

```tsx
  const params = await searchParams;
  const { month: currentMonth, year: currentYear } = colombiaYearMonthDay();
  const month = Number(params.month) || currentMonth;
  const year = Number(params.year) || currentYear;
  const isCurrentMonth = month === currentMonth && year === currentYear;
```

por:

```tsx
  const params = await searchParams;
  const { month, year, isCurrentPeriod: isCurrentMonth } = await getSelectedPeriod(params);
```

(El resto del archivo usa `isCurrentMonth`, `month`, `year` exactamente como antes — no hay más cambios. `getSelectedPeriod` ya resuelve URL > cookie > mes real con la misma prioridad que antes tenía solo "URL > mes real".)

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/presupuestos/page.tsx"
git commit -m "feat(periodo): Presupuestos usa getSelectedPeriod (URL > cookie > mes real)"
```

---

### Task 12: Build completo + verificación en vivo + PR

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Build completo**

Run: `npm run build`
Expected: build exitoso, sin errores. `/ventas`, `/financiero`, `/presupuestos` siguen apareciendo como rutas dinámicas (`ƒ`).

- [ ] **Step 2: Levantar el servidor de preview**

Usar `preview_start` con la config `utilia-dev` existente en `.claude/launch.json`.

- [ ] **Step 3: Login y verificación del selector en las 3 páginas**

Credenciales: `admin@utilia.co` / `utilia2026!`. Navegar a `/ventas` — confirmar que aparecen las flechas `◀ {Mes} {Año} ▶` en el header, con `▶` deshabilitada (mes actual). Click en `◀` — confirmar que la página refresca mostrando datos de un mes anterior, y que el título del gráfico/KPIs cambian a mostrar el nombre del mes.

- [ ] **Step 4: Verificar persistencia al navegar entre páginas**

Con un mes pasado seleccionado en Ventas, navegar a Financiero (vía sidebar) — confirmar que el header sigue mostrando el MISMO mes (no resetea al actual), y que el veredicto/waterfall/MonthCompare reflejan ese mes. Confirmar que aparecen las notas "Este punto de equilibrio es de hoy..." y "Este flujo de caja es de ahora mismo..." sobre Breakeven/CashFlow.

- [ ] **Step 5: Verificar Presupuestos**

Navegar a Presupuestos (aún con el mes pasado activo) — confirmar que muestra ESE mes (no el actual) y que la URL tiene `?month=&year=` reflejando el mismo mes. Click en `◀`/`▶` ahí y confirmar que la URL cambia en consecuencia.

- [ ] **Step 6: Volver a "Hoy"**

Click en el botón "Hoy" desde cualquiera de las 3 páginas — confirmar que vuelve al mes real y que `▶` se deshabilita de nuevo.

- [ ] **Step 7: Confirmar que el selector NO aparece en otras páginas**

Navegar a Categorías o Compras — confirmar que el header NO muestra las flechas de mes (solo "Último sync"/"Sincronizar").

- [ ] **Step 8: Revisar errores**

`preview_console_logs` (level: error) y `preview_logs` (level: error) en el servidor corriendo. Expected: sin errores en ninguno de los dos.

- [ ] **Step 9: Verificación responsive**

Redimensionar a `mobile` (375px). Confirmar que el selector de periodo se ve bien en el header compartido (sin overflow ni solaparse con el botón de menú hamburguesa) en Ventas/Financiero/Presupuestos.

- [ ] **Step 10: Detener el servidor, commit final si hubo fixes de la verificación, y crear el PR**

```bash
git push -u origin feat/selector-periodo-global
gh pr create --base main --title "feat(periodo): selector de periodo global en Ventas, Financiero y Presupuestos" --body "..."
```
(Escribir el cuerpo real del PR en el momento de este paso, resumiendo el cambio y la verificación realizada — no se puede redactar de antemano sin el diff final.)

---

## Self-Review Notes (completado durante la redacción de este plan)

- **Cobertura del spec:** las 5 secciones del spec (mecanismo, Ventas, Financiero, Presupuestos, fuera de alcance) tienen tarea correspondiente. El matiz de MonthCompare (MTD vs. mes completo) está cubierto en la Tarea 6 (lógica) + Tarea 10 (etiquetas). La nota de "esto es de hoy" en Breakeven/CashFlow, y la nota equivalente para el desglose por categoría del Waterfall (no explícita en el spec original pero una extensión directa del mismo patrón ya aprobado), están en la Tarea 9 y la Tarea 7 respectivamente — documentadas aquí como una adición consistente con el espíritu del spec, no una desviación silenciosa.
- **Chequeo de tipos entre tareas:** `getSelectedPeriod()` (Tarea 1) devuelve `{month, year, isCurrentPeriod, realMonth, realYear}` — estos 5 campos se usan exactamente con esos nombres en las Tareas 3, 4, 8, 9 y 11, sin renombrar. `getRevenueWaterfall(year, month)` (Tarea 5), `getMonthComparison(year, month)` (Tarea 6) y `getFinancialData(year, month)`/`getSalesData(year, month)` (Tareas 8-9, funciones locales de cada página) usan el mismo orden de parámetros `(year, month)` de forma consistente.
- **Sin placeholders:** cada paso de código tiene el contenido completo y exacto tal como existe (o quedará) en el repo — verificado contra el estado real de cada archivo antes de escribir este plan.
