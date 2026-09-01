"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDraftPurchaseOrder, translateOdooError } from "@/lib/odoo-write";
import { importSuppliersFromOdoo } from "@/lib/suppliers";

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
 * Aprueba un pedido: persiste ReplenishmentOrder + líneas y, si el proveedor
 * está vinculado a Odoo, crea el borrador de compra allá. Un fallo del RPC no
 * revierte la aprobación: el pedido queda aprobado en Utilia con odooError
 * para que la UI ofrezca reintentar (ver retryOdooDraft).
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
  const totalEstimated = lines.reduce((s, l) => s + l.qty * l.unitCost, 0);

  try {
    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) return { ok: false, error: "Proveedor no encontrado" };

    // Red contra doble clic / reintento de red: el motor de sugerencias ya excluye
    // productos con pedidos abiertos, asi que en el flujo normal esto no se dispara.
    const odooProductIds = lines.map((l) => l.odooProductId);
    const openDuplicate = await prisma.replenishmentOrder.findFirst({
      where: {
        supplierId,
        status: { in: ["APPROVED", "SENT"] },
        lines: { some: { odooProductId: { in: odooProductIds } } },
      },
      select: { id: true },
    });
    if (openDuplicate) {
      return { ok: false, error: "Ya hay un pedido abierto para este proveedor con esos productos" };
    }

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
        // El borrador ya existe en Odoo en este punto. Si el guardado local
        // falla, no perdemos la referencia: se lo decimos al dueño con el
        // numero de la orden para que la busque a mano antes de reintentar
        // (reintentar a ciegas crearia un segundo borrador duplicado).
        try {
          await prisma.replenishmentOrder.update({
            where: { id: order.id },
            data: { odooOrderId: draft.odooOrderId, odooOrderName: draft.odooOrderName },
          });
          odooOrderName = draft.odooOrderName;
        } catch (persistErr) {
          console.error("[approveOrder] borrador creado en Odoo pero no se pudo guardar la referencia:", draft, persistErr);
          odooOrderName = draft.odooOrderName;
          odooError = `Se creó el borrador ${draft.odooOrderName} en Odoo, pero no se pudo guardar la referencia en Utilia. Busca esa orden en Odoo antes de reintentar.`;
        }
      } catch (err) {
        odooError = translateOdooError(err);
      }
    } else {
      odooError = "El proveedor no está vinculado a Odoo";
    }

    revalidatePath("/reabastecimiento");
    return { ok: true, orderId: order.id, odooOrderName, odooError };
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
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * El borrador ya se creó en Odoo pero no se pudo guardar `odooOrderId` en
 * Postgres (dentro de la transacción de `retryOdooDraft`). Se lanza en vez
 * de capturarse in-place porque, una vez que una escritura falla dentro de
 * una transacción de Postgres, la transacción queda abortada: cualquier
 * intento de seguir usando `tx` (incluido un `return` normal, que Prisma
 * traduce en un COMMIT) fallaría igual. Dejar que la excepción haga rollback
 * y clasificarla en el catch de afuera es el único camino confiable para no
 * perder el nombre del borrador ya creado.
 */
class OdooDraftPersistError extends Error {
  odooOrderName: string;
  constructor(odooOrderName: string) {
    super(`Borrador ${odooOrderName} creado en Odoo pero no se pudo guardar la referencia`);
    this.name = "OdooDraftPersistError";
    this.odooOrderName = odooOrderName;
  }
}

/** Reintenta crear el borrador en Odoo para un pedido aprobado que quedó sin orden. */
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
  // Chequeos rapidos sin lock: cubren el caso comun (no hay carrera) sin
  // pagar el costo de abrir una transaccion para un pedido que de todas
  // formas no calificaria.
  if (!order) return { ok: false, error: "Pedido no encontrado" };
  if (order.odooOrderId) return { ok: true, odooOrderName: order.odooOrderName ?? undefined }; // idempotente
  if (order.status !== "APPROVED" && order.status !== "SENT") {
    return { ok: false, error: "El pedido ya no está abierto" };
  }
  if (!order.supplier.odooPartnerId) {
    return { ok: false, error: "El proveedor no está vinculado a Odoo" };
  }

  try {
    // Reclama el pedido con un lock de fila (SELECT ... FOR UPDATE): si dos
    // llamadas concurrentes entran para el mismo pedido (doble clic, dos
    // pestañas), la segunda espera a que esta transacción termine y ve el
    // odooOrderId ya puesto, en vez de llamar a Odoo otra vez y crear un
    // borrador duplicado. El RPC vive dentro del lock a propósito: es la
    // única forma de garantizar exclusión mutua sin agregar una columna
    // nueva al esquema (una reclamación "corta" que se libera antes de
    // llamar a Odoo no sirve, porque no hay ningún campo existente que se
    // pueda usar como marca de "reclamado" sin efectos secundarios: escribir
    // en odooOrderId de una vez exige un valor final real, y un valor
    // centinela chocaria con su restriccion @unique entre pedidos distintos).
    // El volumen es bajo (aprobaciones manuales, no trafico concurrente), asi
    // que mantener una sola fila bloqueada mientras Odoo responde es
    // aceptable aqui; se sube el timeout de la transaccion para no cortar el
    // RPC a medio camino si Odoo tarda.
    const result = await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ odooOrderId: number | null; odooOrderName: string | null; status: string }>>`
          SELECT "odooOrderId", "odooOrderName", "status" FROM "ReplenishmentOrder" WHERE "id" = ${orderId} FOR UPDATE
        `;
        const current = rows[0];
        if (!current) return { ok: false as const, error: "Pedido no encontrado" };
        if (current.odooOrderId) {
          return { ok: true as const, odooOrderName: current.odooOrderName ?? undefined };
        }
        if (current.status !== "APPROVED" && current.status !== "SENT") {
          return { ok: false as const, error: "El pedido ya no está abierto" };
        }

        const draft = await createDraftPurchaseOrder({
          odooPartnerId: order.supplier.odooPartnerId!,
          originRef: `UTILIA-REP-${order.id}`,
          lines: order.lines.map((l) => ({ odooProductId: l.odooProductId, qty: l.qty, priceUnit: l.unitCost })),
        });

        try {
          await tx.replenishmentOrder.update({
            where: { id: order.id },
            data: { odooOrderId: draft.odooOrderId, odooOrderName: draft.odooOrderName },
          });
        } catch (persistErr) {
          console.error("[retryOdooDraft] borrador creado en Odoo pero no se pudo guardar la referencia:", draft, persistErr);
          throw new OdooDraftPersistError(draft.odooOrderName);
        }
        return { ok: true as const, odooOrderName: draft.odooOrderName };
      },
      // maxWait tambien se sube: por defecto Prisma solo espera 2s para
      // *obtener conexion y arrancar* la transaccion. Con el lock del
      // ganador retenido varios segundos (mientras Odoo responde), un
      // segundo llamador necesita poder esperar su turno para arrancar sin
      // que Prisma lo corte antes de tiempo (verificado: con el default de
      // 2s, el segundo llamador fallaba con P2028 "Unable to start a
      // transaction" en vez de esperar el lock y ver el resultado ya
      // guardado).
      { timeout: 20_000, maxWait: 20_000 }
    );
    revalidatePath("/reabastecimiento");
    return result;
  } catch (err) {
    if (err instanceof OdooDraftPersistError) {
      return {
        ok: false,
        odooOrderName: err.odooOrderName,
        error: `Se creó el borrador ${err.odooOrderName} en Odoo, pero no se pudo guardar la referencia en Utilia. Busca esa orden en Odoo antes de reintentar.`,
      };
    }
    return { ok: false, error: translateOdooError(err) };
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
