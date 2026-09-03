"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createDraftPurchaseOrder, translateOdooError } from "@/lib/odoo-write";
import { importSuppliersFromOdoo } from "@/lib/suppliers";
import { setLeadTimeDays, recomputeStockLevels } from "@/lib/analytics/stock-levels";

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
        qty: z.number().int().positive().max(100_000), // unidades enteras: no se piden 2,5
        suggestedQty: z.number().int().nonnegative(),
        unitCost: z.number().nonnegative(),
        reason: z.enum(["critico", "advertencia", "min_stock"]),
      })
    )
    .min(1)
    .max(200),
});

/**
 * Aprueba un pedido: persiste ReplenishmentOrder + líneas y, si el proveedor
 * está vinculado a Odoo, crea el borrador de compra allá. Un fallo del RPC no
 * revierte la aprobación: el pedido queda aprobado en Utilia con odooError
 * para que la UI ofrezca reintentar (ver retryOdooDraft).
 */
export async function approveOrder(
  input: unknown
): Promise<
  ActionResult & {
    orderId?: string;
    odooOrderName?: string | null;
    odooError?: string;
    // Si hay odooError, indica si vale la pena ofrecer un boton de reintento.
    // false para proveedor sin vincular y para el caso "se creo el borrador
    // pero no se guardo la referencia" (reintentar ahi duplicaria la orden
    // real en Odoo); true cuando el RPC en si fallo y nada se creo.
    odooRetryable?: boolean;
  }
> {
  await requireSession();
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }
  const { supplierId, lines } = parsed.data;
  const totalEstimated = lines.reduce((s, l) => s + l.qty * l.unitCost, 0);

  try {
    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) return { ok: false, error: "Proveedor no encontrado" };

    // Red contra doble clic / reintento de red: el motor de sugerencias ya excluye
    // productos con pedidos abiertos, asi que en el flujo normal esto no se dispara.
    // Ojo: el guardia es a proposito POR PRODUCTO (sin filtrar por supplierId) --
    // el motor de sugerencias excluye productos en pedidos abiertos globalmente
    // (ver getReplenishmentPlan), asi que dos pestañas desincronizadas podrian
    // colar el mismo producto en pedidos de DOS proveedores distintos si aqui
    // solo se mirara el proveedor actual.
    const odooProductIds = lines.map((l) => l.odooProductId);
    const openDuplicate = await prisma.replenishmentOrder.findFirst({
      where: {
        status: { in: ["APPROVED", "SENT"] },
        lines: { some: { odooProductId: { in: odooProductIds } } },
      },
      select: { id: true },
    });
    if (openDuplicate) {
      return { ok: false, error: "Ya hay un pedido abierto con alguno de estos productos (puede ser con otro proveedor)" };
    }

    // Si el proveedor esta vinculado a Odoo, la fila nace con el reclamo YA
    // tomado -- mismo mutex y misma columna que usa retryOdooDraft (ver esa
    // funcion mas abajo). Esto es lo que cierra el hueco de duplicado: entre
    // que esta fila se hace visible (create) y que el RPC a Odoo termina
    // (hasta ~180s, ver ODOO_WRITE_TIMEOUT_MS en odoo-write.ts), un
    // retryOdooDraft concurrente sobre este mismo pedido ya no encuentra
    // `odooDraftClaimedAt: null` y no puede ganar el reclamo. Se captura el
    // Date exacto en `claimedAt` para poder liberar despues exactamente ESTE
    // reclamo (compare-and-swap, ver releaseClaim).
    const claimedAt = supplier.odooPartnerId ? new Date() : null;
    const order = await prisma.replenishmentOrder.create({
      data: {
        supplierId,
        totalEstimated,
        odooDraftClaimedAt: claimedAt,
        lines: { createMany: { data: lines } },
      },
    });

    // Borrador en Odoo: solo si el proveedor está vinculado. Si el RPC falla,
    // el pedido queda aprobado en Utilia y se reintenta desde la UI.
    let odooOrderName: string | null = null;
    let odooError: string | undefined;
    let odooRetryable = false;
    if (supplier.odooPartnerId && claimedAt) {
      try {
        const draft = await createDraftPurchaseOrder({
          odooPartnerId: supplier.odooPartnerId,
          originRef: `UTILIA-REP-${order.id}`,
          lines: lines.map((l) => ({ odooProductId: l.odooProductId, qty: l.qty, priceUnit: l.unitCost })),
        });
        // El borrador ya existe en Odoo en este punto. Si el guardado local
        // falla, no perdemos la referencia: se lo decimos al dueño con el
        // numero de la orden para que la busque a mano antes de reintentar
        // (reintentar a ciegas crearia un segundo borrador duplicado). Por
        // eso NO se libera el reclamo aqui: mientras siga vigente (5 min),
        // un clic en "Crear en Odoo" se frena con un aviso de "intento en
        // curso" en vez de disparar un create duplicado.
        try {
          await prisma.replenishmentOrder.update({
            where: { id: order.id },
            data: { odooOrderId: draft.odooOrderId, odooOrderName: draft.odooOrderName, odooDraftClaimedAt: null },
          });
          odooOrderName = draft.odooOrderName;
        } catch (persistErr) {
          console.error("[approveOrder] borrador creado en Odoo pero no se pudo guardar la referencia:", draft, persistErr);
          odooOrderName = draft.odooOrderName;
          odooError = `Se creó el borrador ${draft.odooOrderName} en Odoo, pero no se pudo guardar la referencia en Utilia. Busca esa orden en Odoo antes de reintentar.`;
          odooRetryable = false;
        }
      } catch (err) {
        // El RPC fallo: nada se creo en Odoo, asi que es seguro liberar el
        // reclamo de inmediato para que un reintento legitimo no espere 5
        // minutos.
        await releaseClaim(order.id, claimedAt);
        odooError = translateOdooError(err);
        odooRetryable = true;
      }
    } else {
      odooError = "El proveedor no está vinculado a Odoo";
      odooRetryable = false;
    }

    revalidatePath("/reabastecimiento");
    return { ok: true, orderId: order.id, odooOrderName, odooError, odooRetryable };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Marca el pedido como enviado al proveedor (clic en WhatsApp o manual). */
export async function markSent(orderId: string): Promise<ActionResult> {
  await requireSession();
  try {
    const result = await prisma.replenishmentOrder.updateMany({
      where: { id: orderId, status: "APPROVED" },
      data: { status: "SENT", sentAt: new Date() },
    });
    if (result.count === 0) {
      return { ok: false, error: "El pedido ya no estaba pendiente de envío" };
    }
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
    // updateMany con guarda de estado: evita pisar una transicion concurrente
    // (ej. el sync marcando RECEIVED entre el findUnique y este write).
    const result = await prisma.replenishmentOrder.updateMany({
      where: { id: orderId, status: { in: ["APPROVED", "SENT"] } },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) {
      return { ok: false, error: "El pedido ya no está abierto" };
    }
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "Ya existe un proveedor con ese nombre" };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Un reclamo mas viejo que esto se considera abandonado y se puede retomar.
// El timeout del camino de escritura (ODOO_WRITE_TIMEOUT_MS en
// odoo-write.ts, 60s por llamada RPC) acota createDraftPurchaseOrder a ~180s
// en el peor caso (autenticar + create + search_read del nombre, cada uno
// con su propio limite) -- muy por debajo de estos 5 minutos. Esa es la
// propiedad que hace segura la ventana: cuando un reclamo se considera
// abandonado, el intento original YA tuvo que haber terminado (con exito o
// con error), nunca puede seguir en vuelo.
const CLAIM_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Libera el reclamo de un pedido, pero SOLO si `claimedAt` sigue siendo
 * exactamente la marca que este mismo llamador puso (compare-and-swap por
 * valor). Un release "por id" a secas podria borrar el reclamo ACTIVO de
 * OTRO llamador si, en una interleaving profunda, el nuestro ya habia sido
 * tratado como abandonado y retomado por alguien mas -- habilitando asi un
 * tercer duplicado. Si `claimedAt` ya no coincide, el reclamo actual no era
 * nuestro: no se toca nada, no es un error. Best-effort en general: un
 * fallo de BD aqui no debe tumbar la respuesta que ya se le debe al usuario.
 *
 * Comparten este mutex `approveOrder` (reclama al crear el pedido) y
 * `retryOdooDraft` (reclama antes de reintentar) -- ambos llaman esta misma
 * funcion para liberar.
 */
async function releaseClaim(orderId: string, claimedAt: Date) {
  try {
    const result = await prisma.replenishmentOrder.updateMany({
      where: { id: orderId, odooDraftClaimedAt: claimedAt },
      data: { odooDraftClaimedAt: null },
    });
    if (result.count === 0) {
      console.warn("[releaseClaim] el reclamo ya no era propio al liberar (no se modifico):", orderId);
    }
  } catch (err) {
    console.error("[releaseClaim] no se pudo liberar el reclamo:", orderId, err);
  }
}

/**
 * Reintenta crear el borrador en Odoo para un pedido aprobado que quedó sin
 * orden.
 *
 * El llamado a Odoo (`createDraftPurchaseOrder`) corre siempre FUERA de
 * cualquier transacción de Prisma. Una versión anterior lo hacía dentro de
 * `prisma.$transaction(...)` con un `SELECT ... FOR UPDATE` para excluir
 * llamadas concurrentes, pero eso abre un hueco real: el `fetch` de
 * `jsonRpc` en src/lib/odoo.ts no tiene `AbortController` ni timeout propio
 * (a propósito -- lo comparte el sync, cuyas llamadas pueden tardar
 * legítimamente mucho), así que nada acota cuánto puede durar el RPC. Si
 * Odoo tarda más que el `timeout` de la transacción, Prisma cierra
 * (rollback) esa transacción por su cuenta y libera el lock de fila
 * mientras el RPC sigue en vuelo; un segundo llamador que entre en ese
 * instante ve `odooOrderId` todavía nulo y crea un borrador duplicado en
 * Odoo -- exactamente lo que se buscaba evitar.
 *
 * En vez de eso: se reclama el pedido con UNA sola sentencia `updateMany`
 * atómica (sin transacción, sin lock de fila, sin ventana de tiempo
 * acotada por Prisma) usando la columna `odooDraftClaimedAt`, y solo
 * DESPUÉS de ganar ese reclamo se llama a Odoo, ya sin ningún recurso de
 * Prisma retenido. El reclamo se libera al terminar (éxito o error) para no
 * bloquear un reintento legítimo.
 */
export async function retryOdooDraft(orderId: string): Promise<ActionResult & { odooOrderName?: string }> {
  await requireSession();

  let order;
  try {
    order = await prisma.replenishmentOrder.findUnique({
      where: { id: orderId },
      include: { supplier: true, lines: true },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // Chequeos rapidos: cubren el caso comun (pedido cerrado, ya tiene orden,
  // proveedor sin vincular) sin siquiera intentar el reclamo.
  if (!order) return { ok: false, error: "Pedido no encontrado" };
  if (order.odooOrderId) return { ok: true, odooOrderName: order.odooOrderName ?? undefined }; // idempotente
  if (order.status !== "APPROVED" && order.status !== "SENT") {
    return { ok: false, error: "El pedido ya no está abierto" };
  }
  if (!order.supplier.odooPartnerId) {
    return { ok: false, error: "El proveedor no está vinculado a Odoo" };
  }

  // Reclamo atomico en una sola sentencia UPDATE: solo una llamada
  // concurrente puede ganarlo para este pedido (las demas ven count===0).
  // Un reclamo vigente (menos de 5 minutos) bloquea a los demas; uno viejo
  // se trata como abandonado y se puede retomar. Se guarda `claimedAt` para
  // poder liberar despues exactamente ESTE reclamo (ver releaseClaim).
  const claimedAt = new Date();
  const staleThreshold = new Date(Date.now() - CLAIM_STALE_AFTER_MS);
  const claim = await prisma.replenishmentOrder.updateMany({
    where: {
      id: orderId,
      odooOrderId: null,
      status: { in: ["APPROVED", "SENT"] },
      OR: [{ odooDraftClaimedAt: null }, { odooDraftClaimedAt: { lt: staleThreshold } }],
    },
    data: { odooDraftClaimedAt: claimedAt },
  });

  if (claim.count === 0) {
    // Perdimos el reclamo: otra llamada ya esta creando el borrador (o ya
    // lo termino), o el pedido cambio de estado justo antes. Releemos para
    // responder segun cual haya sido el caso real, en vez de asumir uno solo.
    let fresh;
    try {
      fresh = await prisma.replenishmentOrder.findUnique({
        where: { id: orderId },
        select: { odooOrderId: true, odooOrderName: true, status: true },
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (!fresh) return { ok: false, error: "Pedido no encontrado" };
    if (fresh.odooOrderId) return { ok: true, odooOrderName: fresh.odooOrderName ?? undefined };
    if (fresh.status !== "APPROVED" && fresh.status !== "SENT") {
      return { ok: false, error: "El pedido ya no está abierto" };
    }
    return { ok: false, error: "Ya hay un intento en curso de crear este borrador en Odoo. Espera unos segundos y recarga." };
  }

  // Ganamos el reclamo: a partir de aqui NO hay ninguna transaccion ni lock
  // de Prisma abierto. El RPC puede tardar lo que tarde sin riesgo.
  try {
    const draft = await createDraftPurchaseOrder({
      odooPartnerId: order.supplier.odooPartnerId,
      originRef: `UTILIA-REP-${order.id}`,
      lines: order.lines.map((l) => ({ odooProductId: l.odooProductId, qty: l.qty, priceUnit: l.unitCost })),
    });

    try {
      await prisma.replenishmentOrder.update({
        where: { id: order.id },
        data: { odooOrderId: draft.odooOrderId, odooOrderName: draft.odooOrderName, odooDraftClaimedAt: null },
      });
    } catch (persistErr) {
      // El borrador ya existe en Odoo en este punto; no perdemos la
      // referencia: se lo decimos al dueño con el numero de la orden para
      // que la busque a mano antes de reintentar (reintentar a ciegas
      // crearia un segundo borrador duplicado). Por eso NO se libera el
      // reclamo aqui -- mismo criterio que el catch equivalente en
      // approveOrder: mientras siga vigente (5 min), un clic inmediato en
      // "Crear en Odoo" se frena con "intento en curso" en vez de disparar
      // un create duplicado real en Odoo. Se deja expirar por tiempo.
      console.error("[retryOdooDraft] borrador creado en Odoo pero no se pudo guardar la referencia:", draft, persistErr);
      return {
        ok: false,
        odooOrderName: draft.odooOrderName,
        error: `Se creó el borrador ${draft.odooOrderName} en Odoo, pero no se pudo guardar la referencia en Utilia. Busca esa orden en Odoo antes de reintentar.`,
      };
    }

    revalidatePath("/reabastecimiento");
    return { ok: true, odooOrderName: draft.odooOrderName };
  } catch (err) {
    // El RPC fallo (nada se creo en Odoo): liberamos el reclamo para que un
    // reintento inmediato no quede bloqueado 5 minutos.
    await releaseClaim(order.id, claimedAt);
    return { ok: false, error: translateOdooError(err) };
  }
}

/** Importa/actualiza el directorio de proveedores desde los contactos de Odoo. */
export async function importSuppliersAction(): Promise<
  ActionResult & { created?: number; phonesFilled?: number; linked?: number }
> {
  await requireSession();
  try {
    const res = await importSuppliersFromOdoo();
    revalidatePath("/reabastecimiento");
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const leadTimeSchema = z.object({ days: z.number().int().min(1).max(120) });

/**
 * Ajusta los dias de entrega usados para calcular el punto de reorden y
 * recalcula los niveles de inmediato, para que el cambio se vea al instante
 * en vez de esperar al sync.
 */
export async function setLeadTimeAction(days: number): Promise<ActionResult & { withLevels?: number }> {
  await requireSession();
  const parsed = leadTimeSchema.safeParse({ days });
  if (!parsed.success) return { ok: false, error: "Los dias de entrega deben estar entre 1 y 120" };
  try {
    await setLeadTimeDays(parsed.data.days);
    const r = await recomputeStockLevels();
    revalidatePath("/reabastecimiento");
    revalidatePath("/inventario");
    return { ok: true, withLevels: r.withLevels };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
