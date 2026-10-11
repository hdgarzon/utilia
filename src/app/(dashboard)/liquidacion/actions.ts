"use server";

import { setLiquidationGoal, getDeadStockAnalysis } from "@/lib/analytics/dead-stock";
import { auth } from "@/lib/auth";
import { colombiaToday, daysBetween } from "@/lib/timezone";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const goalSchema = z.object({
  amount: z.coerce.number().positive().max(10_000_000_000),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function updateLiquidationGoal(formData: FormData) {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado" };

  const parsed = goalSchema.safeParse({ amount: formData.get("amount"), deadline: formData.get("deadline") });
  if (!parsed.success) {
    return { ok: false, error: "Monto o fecha inválidos" };
  }
  const daysAhead = daysBetween(colombiaToday(), new Date(`${parsed.data.deadline}T00:00:00Z`));
  if (!(daysAhead >= 7 && daysAhead <= 365)) {
    return { ok: false, error: "La fecha límite debe estar entre 1 semana y 1 año desde hoy" };
  }

  try {
    const analysis = await getDeadStockAnalysis();
    await setLiquidationGoal(parsed.data.amount, analysis.totalInvestedCapital, parsed.data.deadline);
    revalidatePath("/liquidacion");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
