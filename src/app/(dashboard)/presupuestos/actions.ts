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
