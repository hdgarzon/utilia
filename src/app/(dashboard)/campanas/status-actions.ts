"use server";

import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  swapStatusPostProduct,
  regenerateStatusPostCopy,
  updateStatusPostDiscount,
  markStatusPostPosted,
} from "@/lib/analytics/status-posts";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("No autorizado");
}

export async function swapProductAction(id: string) {
  try {
    await requireSession();
    await swapStatusPostProduct(id);
    revalidatePath("/campanas");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function regenerateCopyAction(id: string) {
  try {
    await requireSession();
    await regenerateStatusPostCopy(id);
    revalidatePath("/campanas");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateDiscountAction(id: string, pct: number) {
  try {
    await requireSession();
    await updateStatusPostDiscount(id, pct);
    revalidatePath("/campanas");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function markPostedAction(id: string, posted: boolean) {
  try {
    await requireSession();
    await markStatusPostPosted(id, posted);
    revalidatePath("/campanas");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}
