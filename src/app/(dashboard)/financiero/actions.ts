"use server";

import { setCashBalance } from "@/lib/analytics/cash-flow";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const cashSchema = z.object({
  amount: z.coerce.number().nonnegative().max(10_000_000_000), // hasta 10mil millones COP, suficiente
});

export async function updateCashBalance(formData: FormData) {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado" };

  const parsed = cashSchema.safeParse({ amount: formData.get("amount") });
  if (!parsed.success) {
    return { ok: false, error: "Monto inválido" };
  }

  try {
    await setCashBalance(parsed.data.amount);
    revalidatePath("/financiero");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
