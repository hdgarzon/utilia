"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateTemplates } from "@/lib/products/odoo-catalog-write";
import type { TemplatePatch } from "@/lib/products/types";

// Un archivo "use server" solo puede exportar funciones async; el tipo queda interno.
type BulkActionResult = {
  ok: boolean;
  error?: string;
  okCount?: number;
  failed?: Array<{ id: number; error: string }>;
};

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("No autorizado");
  return session;
}

/**
 * El tope de 500 no es arbitrario: son 10 lotes de 50, que en el peor caso
 * (todos fallan y se reintentan uno a uno) son 510 llamadas RPC. Mas que eso
 * y la accion se pasaria del limite de tiempo de la funcion serverless.
 */
const bulkSchema = z
  .object({
    ids: z
      .array(z.number().int().positive())
      // Mensajes propios: los de Zod salen en ingles y esta app es toda en
      // español. El de 500 ademas tiene que decir QUE hacer, no solo que no.
      .min(1, { message: "No hay productos seleccionados" })
      .max(500, { message: "Maximo 500 productos por operacion. Filtra y aplica en tandas." }),
    categoryId: z.number().int().positive().optional(),
    publicCategoryIds: z.array(z.number().int().positive()).optional(),
    isPublished: z.boolean().optional(),
    purchaseTaxIds: z.array(z.number().int().positive()).optional(),
    supplierPartnerId: z.number().int().positive().optional(),
  })
  .refine(
    (v) =>
      v.categoryId !== undefined ||
      v.publicCategoryIds !== undefined ||
      v.isPublished !== undefined ||
      v.purchaseTaxIds !== undefined ||
      v.supplierPartnerId !== undefined,
    { message: "No se indico ningun cambio" }
  );

export async function applyBulkChange(input: unknown): Promise<BulkActionResult> {
  await requireSession();

  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos invalidos" };
  }

  const { ids, ...patch } = parsed.data;

  try {
    const result = await updateTemplates(ids, patch as TemplatePatch);
    revalidatePath("/productos");
    return { ok: true, okCount: result.ok.length, failed: result.failed };
  } catch (err) {
    console.error("[productos] fallo el cambio masivo:", err);
    return { ok: false, error: "No se pudo aplicar el cambio. Revisa la conexión con Odoo." };
  }
}
