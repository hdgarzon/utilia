# Mejoras a "Estados de hoy" en Campañas — Design Spec

**Fecha:** 2026-07-10
**Origen:** Sobre la feature de plantillas A/B/C ya implementada, el usuario pidió 4 mejoras a la experiencia de "Estados de hoy" en `/campanas`: ocultar la insignia de descuento cuando es 0%, poder elegir a mano qué producto se muestra (no solo la cola automática), un logo más visible en las 3 plantillas, y un indicador de carga mientras se aplican cambios.

## Problema

1. Las 3 plantillas (`templates.tsx`) siempre dibujan la insignia `-{X}%`, incluso cuando `discountPct` es 0 (valor válido, alcanzable desde el input "Desc.").
2. El único mecanismo para cambiar el producto de una tarjeta es el botón "Cambiar", que avanza a "el siguiente" en la cola de capital muerto ordenada por capital invertido — el operador no elige cuál.
3. El logo es pequeño/poco prominente, sobre todo en la plantilla C (96px suelto, sin insignia).
4. Ninguna acción (`setTemplateAction`, `swapProductAction`, etc.) muestra un spinner: los botones solo se deshabilitan y la imagen nueva aparece de golpe cuando termina.

## Objetivo

Resolver las 4 mejoras sin tocar la selección automática diaria de los 3 productos (`getOrCreateTodayStatusPosts`), que sigue funcionando igual.

## Alcance

- Ocultar la insignia de descuento en las 3 plantillas cuando `discountPct === 0`.
- Reemplazar el botón "Cambiar" por un selector manual de producto con dos pestañas: **Liquidación** (capital muerto, lógica actual) y **Regulares** (resto del inventario con stock).
- Agrandar el logo en las 3 plantillas.
- Overlay + spinner sobre la preview, y mini-spinner en el botón que disparó la acción, mientras `pending` es `true`.

Fuera de alcance: cambiar cómo se eligen los 3 productos del día, nuevas plantillas, persistir en el schema si un `StatusPost` vino de liquidación o regular (se infiere de `discountPct`/`rotationDays` en el momento, no hace falta guardarlo).

## 1. Ocultar insignia de descuento en 0%

**Archivo:** `src/app/api/estados/[id]/templates.tsx`

Envolver cada insignia en `d.discountPct > 0 && (...)`:
- **Template A** (líneas 37-39): el círculo verde rotado arriba-derecha desaparece por completo si no hay descuento.
- **Template B** (línea 68): la pill `-{X}% HOY` desaparece; el resto del layout (foto, banda, nombre, precios) no depende de su posición porque está en `position: absolute`.
- **Template C** (línea 99): hoy la pill vive dentro de una fila `justifyContent: space-between` junto al precio final. Sin descuento, esa fila debe quedar solo con el precio (sin `space-between` forzando un hueco vacío a la derecha) — cambiar el contenedor para que, si no hay insignia, el precio no se estire raro (ej. `justifyContent: flex-start` cuando `discountPct === 0`, o envolver ambos en un `flex` que colapse naturalmente).

El precio tachado ("Antes {salePrice}") **no** se oculta — el pedido fue específicamente sobre la insignia de descuento. Con `discountPct === 0`, `salePrice === finalPrice`, así que el tachado y el precio final se verán iguales; se acepta como comportamiento esperado (fuera de alcance ocultarlo también).

## 2. Selector manual de producto (reemplaza "Cambiar")

### Datos — `src/lib/analytics/status-posts.ts`

Nueva función junto a `rankedDeadStock()`:

```ts
export interface PickerCandidate {
  odooProductId: number;
  name: string;
  category: string | null;
  stockQty: number;
  salePrice: number;
  rotationDays: number;
}

export async function rankedRegularStock(): Promise<PickerCandidate[]>
```

Consulta `prisma.productInsight.findMany({ where: { rotationDays: { lte: 30 }, stockQty: { gt: 0 } } })` (complemento exacto del filtro de `rankedDeadStock`), mapeado igual, ordenado por `stockQty` desc (o nombre — a definir en implementación, no crítico).

`rankedDeadStock()` se exporta también (hoy es privada) para reusarla desde la página.

Nueva función de selección explícita, hermana de `swapStatusPostProduct`:

```ts
export async function pickStatusPostProduct(id: string, odooProductId: number): Promise<StatusPost>
```

- Busca el producto en `ProductInsight` por `odooProductId`. Si no existe o no tiene stock → error.
- Si ya está usado en otro slot del mismo día (`usedToday`, misma comprobación que `swapStatusPostProduct`) → error ("Producto ya usado en otra tarjeta hoy").
- Decide el "modo" **por el dato real**, no por lo que mandó el cliente: `rotationDays > 30` ⇒ modo liquidación (`discountPct = discountForRotation(rotationDays)`); si no ⇒ modo regular (`discountPct = 0`).
- Genera el copy con `generateCopy(...)`, pasando un flag/tono según el modo (ver más abajo).
- Actualiza el `StatusPost` igual que `swapStatusPostProduct` (producto, precios, copy, `posted: false`, `postedAt: null`).

### Copy IA — tono según el modo

`generateCopy` recibe un parámetro nuevo `mode: "liquidacion" | "regular"` y selecciona system prompt:
- `liquidacion` → `COPY_SYSTEM_PROMPT` actual (urgencia/oferta), sin cambios.
- `regular` → prompt nuevo, ej.: *"Escribes ganchos cortísimos para Estados de WhatsApp destacando productos del catálogo regular (no son oferta ni liquidación). Tono cercano, destaca calidad/popularidad, sin urgencia falsa ni mencionar descuento."* Mismo formato (1 línea, máx 40 caracteres, 1 emoji opcional).
- `fallbackCopy` gana un caso para `regular` (ej. `"✨ Recomendado del día"`) en vez de siempre asumir liquidación.

Los llamadores existentes (`createPostFromCandidate`, `swapStatusPostProduct`, `regenerateStatusPostCopy`) siguen mandando `mode: "liquidacion"` (no cambian de comportamiento).

### Server action — `src/app/(dashboard)/campanas/status-actions.ts`

```ts
export async function pickProductAction(id: string, odooProductId: number)
```

Mismo patrón try/catch + `requireSession()` + `revalidatePath("/campanas")` que las demás.

### Página — `src/app/(dashboard)/campanas/page.tsx`

Junto a `getOrCreateTodayStatusPosts()`, cargar en paralelo (`Promise.all`) las dos listas para el picker:

```ts
const [statusPosts, liquidacionPool, regularPool] = await Promise.all([
  getOrCreateTodayStatusPosts(),
  rankedDeadStock(),
  rankedRegularStock(),
]);
```

y pasarlas como props a `StatusPostsToday` (`liquidacionPool`, `regularPool`). Es el mismo patrón que ya usa `DeadStockTable`: se trae todo una vez server-side y el diálogo filtra/busca en cliente, sin round-trips nuevos al abrir el picker.

### UI — `src/components/dashboard/StatusPostsToday.tsx`

- El botón "Cambiar" (ícono `Shuffle`) se reemplaza por **"Elegir producto"** (ícono `Search` o similar), que abre un diálogo modal.
- No existe todavía un componente `Dialog` en `src/components/ui/` — agregar uno (patrón shadcn: overlay + panel centrado, cerrable con click afuera/Escape). Puede ser un componente propio simple, no hace falta el paquete completo de shadcn si no se usa en otro lado.
- Contenido del diálogo:
  - Input de búsqueda (filtra por nombre, client-side, sobre la lista de la pestaña activa).
  - Dos pestañas: "🔥 Liquidación" y "Regulares", cada una lista su pool (`liquidacionPool` / `regularPool` recibidos como props, excluyendo productos con `odooProductId` ya usados en las otras tarjetas del día — se calcula en cliente comparando contra los `post.odooProductId` visibles, o se expone `odooProductId` en `StatusPostView` para poder filtrar).
  - Cada fila: nombre, categoría, stock, y en Liquidación también días sin rotar. Click → `run(() => pickProductAction(post.id, candidate.odooProductId), "Producto actualizado")` y cierra el diálogo.
- `StatusPostView` suma `odooProductId: number` (hace falta para excluir duplicados en el picker).

## 3. Logo más visible

**Archivo:** `src/app/api/estados/[id]/templates.tsx`

- **Template A:** insignia blanca de `200×200` → `240×240`; logo interno de `176×176` → `210×210`. Mantiene posición arriba-izquierda.
- **Template B:** insignia de `210×210` → `240×240`; logo de `186×186` → `210×210`.
- **Template C:** el logo suelto de `96×96` (sin fondo, inline con "LIQUIDACIÓN") se reemplaza por una insignia blanca propia (mismo tratamiento que A/B, adaptada al layout inferior de C: podría ir como badge pequeño junto al texto en vez de esquina superior, ya que C no tiene badges de esquina) — tamaño de insignia ~130×130, logo interno ~110×110, notablemente más grande que el actual 96px suelto.

Los tamaños exactos se ajustan durante implementación mirando el resultado renderizado (Satori/`next/og`), pero la dirección es: badges ~15-20% más grandes en A/B, y C pasa de "logo suelto" a "badge con fondo" como A/B.

## 4. Indicador de carga

**Archivo:** `src/components/dashboard/StatusPostsToday.tsx`

Dentro de `StatusCard`, usando el `pending` que ya devuelve `useTransition()`:

- **Overlay sobre la preview:** cuando `pending`, superponer sobre el `<img>` un `div` con fondo `bg-black/55` y un spinner centrado (`Loader2` de `lucide-react` con `animate-spin`, mismo ícono que ya usa `SyncButton.tsx` como referencia). Cubre el tiempo real de espera: la regeneración de la imagen (`/api/estados/[id]`) ocurre server-side y el `<img>` no tiene su propio evento de carga hoy.
- **Spinner en el botón presionado:** cada botón de acción, en vez de deshabilitarse solo con `opacity-50`, sustituye su ícono (`Download`, `RefreshCw`, `Shuffle`→`Search`, `Check`) por `Loader2 animate-spin` mientras esa acción específica está en curso. Como `pending` de `useTransition` es único por tarjeta (no por botón), se necesita trackear cuál acción se disparó: un `useState<string | null>` (`activeAction`) que se setea al llamar `run(...)` y se limpia al terminar, para saber qué botón mostrar con spinner vs. cuáles solo deshabilitar.

```ts
const [activeAction, setActiveAction] = useState<string | null>(null);

function run(action: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
  setActiveAction(action);
  startTransition(async () => {
    const r = await fn();
    setActiveAction(null);
    // ...toast + router.refresh() igual que hoy
  });
}
```

Todos los botones se siguen deshabilitando con `disabled={pending}` (comportamiento actual, congela la tarjeta completa durante cualquier acción); el spinner solo cambia qué ícono se ve en el botón que corresponde a `activeAction`.

## Manejo de errores

- `pickStatusPostProduct`: producto no encontrado, sin stock, o ya usado hoy → mensaje de error específico devuelto por la server action, mostrado con `toast.error` (patrón ya existente).
- Igual que las demás acciones: cualquier excepción se captura en la server action y se retorna `{ ok: false, error }`.

## Testing

- `npx tsc --noEmit` limpio.
- Verificación en preview:
  - Poner `discountPct` en 0 vía "Desc." y confirmar que la insignia desaparece sin dejar huecos raros en A, B y C.
  - Abrir el picker, cambiar de pestaña, buscar, elegir un producto de Liquidación (debe traer descuento y copy de urgencia) y uno de Regulares (0% y copy neutro).
  - Confirmar que un producto usado en otra tarjeta del día no aparece seleccionable (o da error) en el picker de otra tarjeta.
  - Comparar visualmente el tamaño del logo antes/después en las 3 plantillas.
  - Disparar cualquier acción y confirmar overlay + spinner en el botón correspondiente durante el tiempo de espera.
