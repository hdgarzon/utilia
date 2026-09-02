"use server";

import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  regenerateStatusPostCopy,
  updateStatusPostDiscount,
  markStatusPostPosted,
  updateStatusPostTemplate,
  pickStatusPostProduct,
  addStatusPost,
  addGanchoPost,
  updateGanchoText,
  suggestGanchoText,
  deleteStatusPost,
  type NewPostOrigin,
} from "@/lib/analytics/status-posts";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("No autorizado");
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

export async function setTemplateAction(id: string, template: string) {
  try {
    await requireSession();
    if (template !== "A" && template !== "B" && template !== "C") {
      return { ok: false as const, error: "Plantilla inválida" };
    }
    await updateStatusPostTemplate(id, template);
    revalidatePath("/campanas");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function pickProductAction(id: string, odooProductId: number) {
  try {
    await requireSession();
    await pickStatusPostProduct(id, odooProductId);
    revalidatePath("/campanas");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function addStatusPostAction(origin: NewPostOrigin) {
  try {
    await requireSession();
    if (origin.kind !== "liquidacion" && origin.kind !== "regular" && origin.kind !== "producto") {
      return { ok: false as const, error: "Origen inválido" };
    }
    await addStatusPost(origin);
    revalidatePath("/campanas");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function addGanchoAction(headline: string, subhead: string) {
  try {
    await requireSession();
    await addGanchoPost(headline, subhead);
    revalidatePath("/campanas");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateGanchoAction(id: string, headline: string, subhead: string) {
  try {
    await requireSession();
    await updateGanchoText(id, headline, subhead);
    revalidatePath("/campanas");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function suggestGanchoAction(tema: string) {
  try {
    await requireSession();
    const text = await suggestGanchoText(tema);
    return { ok: true as const, text };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deletePostAction(id: string) {
  try {
    await requireSession();
    await deleteStatusPost(id);
    revalidatePath("/campanas");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}
