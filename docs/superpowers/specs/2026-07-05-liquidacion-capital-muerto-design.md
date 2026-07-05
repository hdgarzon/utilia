# Plan de Liquidación de Capital Muerto — Design Spec

**Fecha:** 2026-07-05
**Origen:** Auditoría de dashboard (UX/UI/Datos) — hallazgo #2 del informe ejecutivo: "$22.8M inmovilizados (87% del inventario) sin ningún plan de acción, mientras los productos que generan el 80% de los ingresos operan con lo mínimo ($1.1M)."

## Problema

Hoy el capital muerto está fragmentado en dos lugares con reglas distintas:
- `src/lib/analytics/opportunities.ts` → `deadStock` / `deadStockTotal`: productos con `avgDailySales7d === 0`, top 8, mostrados en una tarjeta pequeña dentro de ABC/Pareto.
- `src/app/(dashboard)/inventario/page.tsx` → sección "Sin Rotación (>30 días)": productos con `rotationDays > 30 && stockQty > 0`, top 15, sin cifra de capital agregada destacada.

Ninguna de las dos da una vista completa, ninguna permite simular qué pasa si se liquida a descuento, y no existe forma de fijar y trackear una meta de liberación de caja. El dinero atrapado en inventario sin rotar es la oportunidad de mayor valor económico identificada en la auditoría y no tiene pantalla propia.

## Alcance

Página nueva en el nav: **Liquidación** (`/liquidacion`), siguiente a Compras en `nav-config.tsx`.

### Definición única de "capital muerto"

`rotationDays > 30 AND stockQty > 0` — reemplaza la regla de `opportunities.ts` (que usaba velocidad de venta = 0) como la definición canónica para esta pantalla. Se elige por sobre la alternativa porque distingue "nunca vendió" de "vendía pero se detuvo" y da una fecha concreta de referencia (última venta), en vez de un booleano de ventana de 7 días.

**Nota de decisión:** `opportunities.ts` sigue usando su propia regla para las tarjetas de ABC (`opps.deadStock`), fuera de alcance de este cambio — no se toca ese módulo. La nueva pantalla es la fuente de verdad completa; la tarjeta de ABC sigue siendo un resumen de 8 ítems con su propia lógica preexistente.

Sin consolidación de variantes por template: a diferencia de ABC/Oportunidades (donde promediar variantes por velocidad tiene sentido para analizar revenue), liquidar es una acción física por SKU concreto — el color/talla exacto que sobra en el estante. Cada fila es un `ProductInsight` individual.

## Arquitectura

### 1. Módulo de analítica — `src/lib/analytics/dead-stock.ts`

```ts
export interface DeadStockProduct {
  id: string;
  name: string;
  category: string | null;
  stockQty: number;
  cmp: number;              // costo unitario
  salePrice: number;
  rotationDays: number;
  lastSoldAt: Date | null;
  investedCapital: number;  // stockQty * cmp
  retailValue: number;      // stockQty * salePrice
}

export interface DeadStockByCategory {
  category: string;
  investedCapital: number;
  retailValue: number;
  productCount: number;
}

export interface DeadStockAnalysis {
  products: DeadStockProduct[];         // todos, sin cap — la tabla pagina/filtra en cliente
  totalInvestedCapital: number;
  totalRetailValue: number;
  totalInventoryValue: number;          // valor de TODO el inventario (para el % del titular)
  deadStockPctOfInventory: number;      // totalInvestedCapital / totalInventoryValue * 100
  byCategory: DeadStockByCategory[];    // ordenado por investedCapital desc
}

export async function getDeadStockAnalysis(): Promise<DeadStockAnalysis>
```

Query: `ProductInsight` donde `rotationDays > 30 AND stockQty > 0`, más una segunda consulta (o agregado del mismo dataset) para `totalInventoryValue` = `SUM(stockQty * cmp)` de **todo** `ProductInsight` con `stockQty > 0` (para poder mostrar "el capital muerto es el X% del inventario total").

### 2. Meta de liberación de caja — persistencia y cálculo

Reutiliza el modelo `Setting` (mismo patrón que `cash_balance` en `cash-flow.ts`), sin tabla nueva:

- `dead_stock_goal_amount`: monto objetivo a liberar (string numérico, como `cash_balance`).
- `dead_stock_goal_baseline`: capital muerto total (`totalInvestedCapital`) capturado en el momento de fijar/editar la meta.
- `dead_stock_goal_set_at`: timestamp (se puede derivar de `Setting.updatedAt`, no necesita columna propia si se guarda como parte del mismo registro — usar `updatedAt` de la fila `dead_stock_goal_amount`).

**Mecánica de progreso — automática, sin marcar nada a mano:**
```
progreso = clamp(baseline − capital_muerto_actual, 0, baseline)
pct = progreso / meta_amount * 100  // puede superar 100% si se liberó más de lo pedido
```
La barra visual se clampea a 100% de ancho (mismo patrón que `BreakevenCard`: `progressClamped` limita el fill, pero la etiqueta de texto muestra el `pct` real sin clampear, ej. "142%" cuando se superó la meta).
Cuando el usuario edita la meta (mismo componente `Edit2`/pencil que `CashBalanceEditor`), se guardan `dead_stock_goal_amount` (el nuevo valor ingresado) Y `dead_stock_goal_baseline` (el `totalInvestedCapital` actual en ese momento) juntos, en la misma acción de servidor. Así cada vez que se fija una meta nueva, el progreso arranca en 0% y sube a medida que el sync de Odoo refleje ventas reales de ese stock.

Nuevas funciones en `src/lib/analytics/dead-stock.ts`:
```ts
export interface LiquidationGoal {
  goalAmount: number;
  baseline: number;
  updatedAt: Date | null;
  currentDeadStock: number;   // = totalInvestedCapital actual, para calcular progreso en el componente
}
export async function getLiquidationGoal(): Promise<LiquidationGoal>
```

Server action nueva en `src/app/(dashboard)/liquidacion/actions.ts`:
```ts
export async function updateLiquidationGoal(formData: FormData): Promise<{ ok: boolean; error?: string }>
```
Valida `amount > 0`, obtiene `totalInvestedCapital` actual vía `getDeadStockAnalysis()`, hace upsert de `dead_stock_goal_amount` y `dead_stock_goal_baseline` en `Setting`, `revalidatePath("/liquidacion")`.

### 3. Componentes cliente

**`GoalEditor.tsx`** (mirror casi exacto de `CashBalanceEditor.tsx`): tarjeta con meta, progreso ($ liberado de $ meta) y barra de progreso (mismo estilo que `BudgetRow`/`BreakevenCard`). Lápiz para editar el monto objetivo.

**`DiscountScenarioCalculator.tsx`**: 3 botones (20% / 30% / 50%, con opción de "otro %" via input) que recalculan en cliente (sin servidor, mismo patrón que el filtrado de `InventoryTable`):
- Efectivo recuperado = `Σ stockQty * salePrice * (1 − descuento%)` sobre el dataset visible (respeta el filtro de categoría activo, si hay uno).
- Comparación vs `investedCapital` total → gain/loss neto de liquidar a ese descuento.
- El descuento seleccionado se pasa como prop/estado compartido a la tabla de abajo para mostrar "precio sugerido de liquidación" por fila.

**`DeadStockTable.tsx`** (client component, mismo patrón que `InventoryTable`/`ABCTable`, reutiliza `table-controls.tsx` y `csv.ts`):
- Filtro por categoría (chips, como Tier en `ABCTable`).
- Columnas ordenables: Producto, Categoría, Stock, Días sin venta, Capital invertido (CMP), Valor retail, **Precio sugerido de liquidación** (= `salePrice * (1 − descuentoSeleccionado%)`, columna dinámica según el descuento activo en la calculadora).
- Export CSV incluye el precio sugerido de liquidación al descuento seleccionado.
- Cabecera fija + scroll interno para listas largas (mismo patrón que `InventoryTable`).

### 4. Página — `src/app/(dashboard)/liquidacion/page.tsx`

`force-dynamic`, server component. Fetch en paralelo: `getDeadStockAnalysis()` + `getLiquidationGoal()`. Estructura (de arriba a abajo):

1. **Header + veredicto**: "Plan de Liquidación" + titular en lenguaje natural: *"$22.8M inmovilizados — el 87% de tu inventario total no se ha vendido en 30+ días."* Mismo estilo de tarjeta-pregunta que Home/Financiero (borde + fondo de color según severidad, ej. `destructive` si `deadStockPctOfInventory > 50`, `warning` si > 25, `default` debajo).
2. **`GoalEditor`**: meta + progreso.
3. **`DiscountScenarioCalculator`**: mantiene el estado del % de descuento seleccionado (client component "orquestador" que envuelve calculadora + tabla, ya que ambas comparten el descuento activo — ver Nota de composición abajo).
4. **Desglose por categoría**: mini-tabla o barras horizontales (`byCategory`), mismo estilo visual que el "Peso relativo" de `CategoriasTable` — para priorizar qué categoría atacar primero.
5. **`DeadStockTable`**: tabla completa.

**Nota de composición:** dado que la calculadora de descuento y la tabla comparten el % de descuento seleccionado, ambas viven dentro de un único client component padre (ej. `LiquidationWorkspace.tsx`) que mantiene el estado `discountPct` y renderiza `DiscountScenarioCalculator` + `DeadStockTable` como hijos — evita prop-drilling artificial de estado entre dos componentes hermanos independientes y mantiene cada uno enfocado en su propia responsabilidad (calculadora = resumen agregado, tabla = detalle por fila).

### 5. Nav

`src/components/layout/nav-config.tsx`: nuevo ítem `{ href: "/liquidacion", label: "Liquidación", icon: PackageX }` (ícono `PackageX` de `lucide-react`), después de `/compras`.

## Fuera de alcance

- No se modifica `opportunities.ts` ni la tarjeta "Liquidar — capital muerto" de ABC/Pareto — quedan como están (resumen de 8 ítems, regla propia).
- No hay checkbox ni acción manual de "marcar como liquidado" — el progreso de la meta es 100% derivado de datos ya sincronizados.
- No hay integración con Campañas/WhatsApp para promocionar estos productos (mencionado como oportunidad futura en el informe, pero es una feature aparte).
- No hay edición de precio real en Odoo — el "precio sugerido de liquidación" es solo informativo/calculado, no escribe de vuelta a Odoo.
