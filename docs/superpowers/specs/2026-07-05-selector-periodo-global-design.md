# Selector de Periodo Global — Design Spec

**Fecha:** 2026-07-05
**Origen:** Auditoría de dashboard — punto #10 del informe ejecutivo: "hoy todo está clavado a MTD o 60 días y no hay forma de responder '¿cómo nos fue en junio?' sin esperar a que sea julio."

## Problema

Solo 2 de las 9 pantallas del dashboard manejan un "periodo" navegable en el sentido que pide el informe (Ventas, Financiero), y ambas tienen el mes actual hardcodeado sin forma de verlo cambiar. Una tercera (Presupuestos) ya soporta `?month=&year=` en su lógica server-side pero nunca tuvo un control de navegación — el usuario tendría que editar la URL a mano.

Las demás pantallas (Categorías, ABC, Compras, Flujo de Caja, Patrón Semanal) **no** manejan un "periodo" en este sentido: proyectan desde velocidad de venta actual (snapshot de punto en el tiempo, sin histórico) o usan ventanas rodantes fijas por diseño metodológico (30 días de COGS real, 60 días de muestra estadística). Aplicarles un selector de mes sería forzar una semántica que no tienen — quedan fuera de alcance.

## Alcance

Selector de mes/año compartido entre **Ventas, Financiero y Presupuestos**, visible solo en esas 3 rutas, que persiste al navegar entre ellas.

## Arquitectura

### Mecanismo: cookie compartida + control en el layout

- Cookie `selected_period` (formato `"YYYY-MM"`), gestionada por un server action.
- Un componente cliente `PeriodSelector` vive en el header compartido (`src/app/(dashboard)/layout.tsx`), junto a "Último sync". Usa `usePathname()` y solo se renderiza en `/ventas`, `/financiero`, `/presupuestos` — en el resto de rutas no aparece.
- Una función compartida `getSelectedPeriod()` (nueva, `src/lib/period.ts`) es la única fuente de verdad server-side sobre "qué mes estamos viendo": la usan tanto el layout como las 3 páginas, evitando que layout y página alguna vez muestren meses distintos.

**Prioridad de fuente:** parámetro de URL explícito (`?month=&year=`, solo relevante en Presupuestos) > cookie > mes real de hoy (`colombiaYearMonthDay()`).

**Al cambiar de mes**, `PeriodSelector` siempre hace dos cosas en orden:
1. Llama al server action para actualizar la cookie (fuente de verdad para cuando el usuario navegue a otra de las 3 páginas).
2. Si la ruta actual es `/presupuestos`, navega con `router.push("/presupuestos?month=X&year=Y")` (preserva URLs compartibles y el flujo existente de "Clonar a otro mes", que no se toca). En `/ventas` y `/financiero` (que no tienen URL params históricamente), simplemente hace `router.refresh()`.

**Límites de navegación:** la flecha `▶` (mes siguiente) se deshabilita cuando el mes visualizado ya es el mes real actual — no se puede navegar al futuro. No hay límite inferior artificial (si no hay datos para un mes muy antiguo, la página ya maneja el caso vacío como hoy). Un botón "Hoy" (visible solo si no estás en el mes actual) salta directo al mes real.

### Archivos nuevos

- `src/lib/period.ts` — `getSelectedPeriod(urlOverride?): Promise<{ month, year, isCurrentPeriod }>`.
- `src/app/(dashboard)/period-actions.ts` — server action `setSelectedPeriod(month, year)`, solo escribe la cookie (no hay `revalidatePath`; el refresh lo dispara el cliente).
- `src/components/layout/PeriodSelector.tsx` — client component (flechas + label + botón "Hoy"), recibe `month`, `year`, `isCurrentPeriod`, `realMonth`, `realYear` como props desde el layout (el "Hoy" salta a `realMonth`/`realYear`, calculados en Colombia-time server-side — nunca con el reloj local del navegador, para no depender de la zona horaria del cliente).

### Archivos modificados — qué se vuelve navegable y qué no

**`src/app/(dashboard)/layout.tsx`**: llama a `getSelectedPeriod()`, renderiza `<PeriodSelector />` con los props resueltos.

**Ventas** (`src/app/(dashboard)/ventas/page.tsx`): KPIs (ingresos/transacciones/ticket) y el gráfico diario pasan a consultar el mes seleccionado (rango acotado: inicio del mes → inicio del mes siguiente, no solo `gte` como hoy — sin el límite superior, ver un mes pasado traería también todo lo que pasó después). Etiquetas de KPI cambian de "mes actual" a mostrar el nombre del mes cuando no es el actual.

El **Patrón Semanal** (ventana fija de 60 días) y el **Top 10 por velocidad** (basado en `avgDailySales7d` de `ProductInsight` — un snapshot de la velocidad *actual*, sin histórico por mes) **no cambian con el selector**: no es una omisión, es que no existe dato histórico de velocidad por producto para poder hacerlo. Ninguno de los dos necesita cambio de código más allá de quedar como están.

**Financiero** (`src/app/(dashboard)/financiero/page.tsx`): el veredicto principal, la cascada "¿A dónde va tu dinero?" (`getRevenueWaterfall`), el presupuesto por categoría, y `MonthCompare` (`getMonthComparison`) pasan a usar el mes seleccionado.

- `getRevenueWaterfall()` gana parámetros `(year, month)` — antes usaba `colombiaStartOfMonth()` sin límite superior; ahora acota también al inicio del mes siguiente.
- `getMonthComparison()` gana parámetros `(year, month)` que reemplazan el `colombiaYearMonthDay()` interno como "mes actual de referencia" — el resto de su lógica (comparar contra el mes anterior) no cambia.
  - **Matiz importante:** si el mes seleccionado ES el mes real en curso, `currentMTD` sigue siendo "los mismos N días transcurridos" como hoy (comparación justa de un mes que aún no cierra). Si el mes seleccionado es un mes **pasado y ya cerrado**, comparar solo hasta "el día de hoy" no tiene sentido (ej. si hoy es 5 de julio, capar junio al día 5 sería arbitrario) — en ese caso `currentMTD`/`previousMTD` pasan a ser el mes completo (`dayCap` = días totales del mes), es decir, se comparan los dos meses completos. La página ya sabe si el periodo seleccionado es el actual (mismo dato que usa para las notas de Breakeven/CashFlow) y se lo pasa a `<MonthCompare>` para que ajuste las etiquetas ("MTD" → "mes completo" cuando corresponda).

El **Punto de Equilibrio Diario** (`BreakevenCard`) y el **Flujo de Caja** (`CashFlowCard`) **no cambian de mes** — siguen mostrando siempre "hoy" y "ahora mismo" (burn rate/runway operativos del presente), sin cambios en `breakeven.ts` ni `cash-flow.ts` ni en los componentes mismos. Cuando el mes seleccionado no es el actual, `financiero/page.tsx` antepone una nota breve a esas dos tarjetas (ej. "Estos datos son de hoy, no de {mes seleccionado}") en vez de ocultarlas — no se pierde información, solo se aclara su alcance.

**Presupuestos** (`src/app/(dashboard)/presupuestos/page.tsx`): gana el control visual compartido en el header (ya no hay que editar la URL a mano) y un cambio pequeño de lógica: hoy su fallback cuando no hay `?month=&year=` en la URL es directo al mes real (`Number(params.month) || currentMonth`); pasa a usar `getSelectedPeriod(params)` (URL explícita > cookie > mes real), para que si el usuario ya eligió un mes en Ventas/Financiero y entra a Presupuestos por el sidebar (sin parámetros en la URL), vea ese mismo mes en vez de resetear al actual. El flujo "Clonar a otro mes" queda intacto, sin relación con el selector (es una acción puntual de copiar presupuestos a un mes destino, no "cuál mes estoy viendo").

## Fuera de alcance

- Categorías, ABC/Pareto, Compras, Flujo de Caja (dentro de Financiero), Patrón Semanal: no se tocan. Sus ventanas de tiempo son fijas por diseño (metodología de negocio o falta de histórico), no un "periodo que se navega".
- No hay URLs compartibles para un mes específico en Ventas/Financiero (la cookie no es visible en la URL) — no se pidió esa capacidad y no existía antes tampoco.
- No se consolida la constante `MONTHS`/`MONTH_NAMES` duplicada en varios archivos (`presupuestos/page.tsx`, `month-compare.ts`, el nuevo `PeriodSelector.tsx`) — es una duplicación ya existente en el código, fuera del alcance de este cambio.
