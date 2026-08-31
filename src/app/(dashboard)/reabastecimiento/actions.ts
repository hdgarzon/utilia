"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

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
 * Aprueba un pedido: persiste ReplenishmentOrder + líneas. La creación del
 * borrador en Odoo se integra en una fase posterior (ver plan, Task 8).
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

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return { ok: false, error: "Proveedor no encontrado" };

  const totalEstimated = lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
  try {
    const order = await prisma.replenishmentOrder.create({
      data: {
        supplierId,
        totalEstimated,
        lines: { createMany: { data: lines } },
      },
    });
    revalidatePath("/reabastecimiento");
    return { ok: true, orderId: order.id, odooOrderName: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Marca el pedido como enviado al proveedor (clic en WhatsApp o manual). */
export async function markSent(orderId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await prisma.replenishmentOrder.updateMany({
      where: { id: orderId, status: "APPROVED" },
      data: { status: "SENT", sentAt: new Date() },
    });
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
    await prisma.replenishmentOrder.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
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
