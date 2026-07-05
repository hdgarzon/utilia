"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(100),
  description: z.string().max(500).optional(),
  templateId: z.string().max(100).optional(),
});

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("No autorizado");
  return session;
}

/**
 * Crea una campaña en estado DRAFT (triggerType MANUAL por defecto del schema).
 * El envío real por WhatsApp aún no existe; las campañas quedan como borrador
 * hasta que se implemente la integración (360dialog).
 */
export async function createCampaign(formData: FormData) {
  await requireSession();
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    templateId: formData.get("templateId") || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  try {
    await prisma.campaign.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        templateId: parsed.data.templateId,
      },
    });
    revalidatePath("/campanas");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
