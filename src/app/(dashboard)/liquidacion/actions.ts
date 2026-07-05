"use server";

import { setLiquidationGoal, getDeadStockAnalysis } from "@/lib/analytics/dead-stock";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const goalSchema = z.object({
  amount: z.coerce.number().positive().max(10_000_000_000),
});

export async function updateLiquidationGoal(formData: FormData) {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado" };

  const parsed = goalSchema.safeParse({ amount: formData.get("amount") });
  if (!parsed.success) {
    return { ok: false, error: "Monto inválido" };
  }

  try {
    const analysis = await getDeadStockAnalysis();
    await setLiquidationGoal(parsed.data.amount, analysis.totalInvestedCapital);
    revalidatePath("/liquidacion");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
