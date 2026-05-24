"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const upsertSchema = z.object({
  id: z.string().optional(),
  category: z.string().min(1).max(50),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2020).max(2100),
  budgetAmount: z.coerce.number().nonnegative(),
  alertPct: z.coerce.number().min(50).max(150).default(90),
});

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("No autorizado");
  return session;
}

export async function upsertBudget(formData: FormData) {
  await requireSession();
  const parsed = upsertSchema.safeParse({
    id: formData.get("id") || undefined,
    category: formData.get("category"),
    month: formData.get("month"),
    year: formData.get("year"),
    budgetAmount: formData.get("budgetAmount"),
    alertPct: formData.get("alertPct") || 90,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const data = parsed.data;
  try {
    if (data.id) {
      await prisma.expenseBudget.update({
        where: { id: data.id },
        data: {
          category: data.category,
          month: data.month,
          year: data.year,
          budgetAmount: data.budgetAmount,
          alertPct: data.alertPct,
        },
      });
    } else {
      await prisma.expenseBudget.upsert({
        where: {
          category_month_year: { category: data.category, month: data.month, year: data.year },
        },
        create: {
          category: data.category,
          month: data.month,
          year: data.year,
          budgetAmount: data.budgetAmount,
          alertPct: data.alertPct,
        },
        update: {
          budgetAmount: data.budgetAmount,
          alertPct: data.alertPct,
        },
      });
    }
    revalidatePath("/presupuestos");
    revalidatePath("/financiero");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const recordExpenseSchema = z.object({
  budgetId: z.string().min(1),
  amount: z.coerce.number().positive(),
  note: z.string().max(200).optional(),
});

/**
 * Registra un gasto real (incrementa actualAmount).
 * Reemplaza la promesa de sync automático desde Odoo, porque la instancia
 * del usuario no registra arriendo/nómina/servicios en account.move.
 */
export async function recordExpense(formData: FormData) {
  await requireSession();
  const parsed = recordExpenseSchema.safeParse({
    budgetId: formData.get("budgetId"),
    amount: formData.get("amount"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }
  try {
    await prisma.expenseBudget.update({
      where: { id: parsed.data.budgetId },
      data: { actualAmount: { increment: parsed.data.amount } },
    });
    revalidatePath("/presupuestos");
    revalidatePath("/financiero");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Resetea el ejecutado de una categoría (útil para corregir errores). */
export async function resetActual(id: string) {
  await requireSession();
  try {
    await prisma.expenseBudget.update({
      where: { id },
      data: { actualAmount: 0 },
    });
    revalidatePath("/presupuestos");
    revalidatePath("/financiero");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const cloneSchema = z.object({
  sourceMonth: z.coerce.number().int().min(1).max(12),
  sourceYear: z.coerce.number().int().min(2020).max(2100),
  targetMonth: z.coerce.number().int().min(1).max(12),
  targetYear: z.coerce.number().int().min(2020).max(2100),
  copyActuals: z.coerce.boolean().default(false),
});

/**
 * Copia los presupuestos de un mes a otro. Útil para:
 *   - Sembrar meses pasados para que la comparativa sea apples-to-apples
 *   - Setup rápido del mes siguiente sin tener que reingresar categorías
 *
 * Si una categoría ya existe en el destino, actualiza solo el budgetAmount
 * (no toca actualAmount existente para no perder data de ejecución real).
 */
export async function cloneBudgets(formData: FormData) {
  await requireSession();
  const parsed = cloneSchema.safeParse({
    sourceMonth: formData.get("sourceMonth"),
    sourceYear: formData.get("sourceYear"),
    targetMonth: formData.get("targetMonth"),
    targetYear: formData.get("targetYear"),
    copyActuals: formData.get("copyActuals") === "true",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }
  const { sourceMonth, sourceYear, targetMonth, targetYear, copyActuals } = parsed.data;

  if (sourceMonth === targetMonth && sourceYear === targetYear) {
    return { ok: false, error: "El mes origen y destino son el mismo" };
  }

  try {
    const source = await prisma.expenseBudget.findMany({
      where: { month: sourceMonth, year: sourceYear },
    });
    if (source.length === 0) {
      return { ok: false, error: "El mes origen no tiene presupuestos" };
    }

    let cloned = 0;
    let updated = 0;
    for (const s of source) {
      const existing = await prisma.expenseBudget.findUnique({
        where: {
          category_month_year: { category: s.category, month: targetMonth, year: targetYear },
        },
      });
      if (existing) {
        await prisma.expenseBudget.update({
          where: { id: existing.id },
          data: {
            budgetAmount: s.budgetAmount,
            alertPct: s.alertPct,
            // copyActuals solo se respeta si el destino no tiene actual previo
            ...(copyActuals && existing.actualAmount === 0 ? { actualAmount: s.actualAmount } : {}),
          },
        });
        updated += 1;
      } else {
        await prisma.expenseBudget.create({
          data: {
            category: s.category,
            month: targetMonth,
            year: targetYear,
            budgetAmount: s.budgetAmount,
            alertPct: s.alertPct,
            actualAmount: copyActuals ? s.actualAmount : 0,
          },
        });
        cloned += 1;
      }
    }
    revalidatePath("/presupuestos");
    revalidatePath("/financiero");
    return { ok: true, cloned, updated, total: source.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteBudget(id: string) {
  await requireSession();
  try {
    await prisma.expenseBudget.delete({ where: { id } });
    revalidatePath("/presupuestos");
    revalidatePath("/financiero");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
