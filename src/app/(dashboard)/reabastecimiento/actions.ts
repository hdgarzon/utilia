"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDraftPurchaseOrder } from "@/lib/odoo-write";
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
