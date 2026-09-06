"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  MAX_IMAGE_BASE64_BYTES,
  MAX_ROWS_PER_BATCH,
  type ImportRowDraft,
} from "@/lib/products/import-types";
import type { ProductType } from "@/lib/products/types";

// Un archivo "use server" solo puede exportar funciones async; los tipos
// quedan internos.
type SaveResult = { ok: boolean; error?: string; batchId?: string };
type LoadResult = {
  ok: boolean;
  error?: string;
  batch?: { id: string; name: string; status: string; rows: ImportRowDraft[] };
};

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("No autorizado");
  return session;
}

const filaSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  name: z.string().max(300),
  productType: z.enum(["consu", "service", "combo"]),
  isStorable: z.boolean(),
  qtyOnHand: z.number().nonnegative().nullable(),
  salePrice: z.number().nonnegative().nullable(),
  cost: z.number().nonnegative().nullable(),
  purchaseTaxIds: z.array(z.number().int().positive()).max(20),
  categoryId: z.number().int().positive().nullable(),
  imageUrl: z.string().max(2000).nullable(),
  imageData: z
    .string()
    .max(MAX_IMAGE_BASE64_BYTES, {
      message: `Cada imagen debe pesar menos de ${Math.round(MAX_IMAGE_BASE64_BYTES / 1000)} KB una vez reducida`,
    })
    .nullable(),
  isPublished: z.boolean(),
  publicCategoryIds: z.array(z.number().int().positive()).max(20),
  showAvailability: z.boolean(),
  supplierPartnerId: z.number().int().positive().nullable(),
});

const saveSchema = z.object({
  batchId: z.string().min(1).nullable(),
  name: z.string().min(1, { message: "Ponle un nombre al lote" }).max(120),
  rows: z.array(filaSchema).max(MAX_ROWS_PER_BATCH, {
    message: `Máximo ${MAX_ROWS_PER_BATCH} filas por lote. Divide la lista en tandas.`,
  }),
});

/**
 * Guarda el borrador completo: crea el lote si no existe y reemplaza sus
 * filas. Se reemplazan y no se diffean porque la hoja es pequeña (tope de
 * 200 filas) y un diff por indice se rompe en cuanto el usuario inserta una
 * fila en medio.
 *
 * Solo toca filas que no se hayan creado todavia: una fila ya OK en Odoo
 * conserva su id y su estado, porque volver a crearla duplicaria el producto.
 */
export async function saveBatch(input: unknown): Promise<SaveResult> {
  const session = await requireSession();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos invalidos" };
  }
  const { batchId, name, rows } = parsed.data;

  try {
    const lote = batchId
      ? await prisma.productImportBatch.update({ where: { id: batchId }, data: { name } })
      : await prisma.productImportBatch.create({
          data: { name, createdBy: session.user?.id ?? null },
        });

    await prisma.$transaction([
      // Las filas ya creadas en Odoo se conservan tal cual.
      prisma.productImportRow.deleteMany({
        where: { batchId: lote.id, status: { not: "OK" } },
      }),
      prisma.productImportRow.createMany({
        data: rows.map((r) => ({ ...r, batchId: lote.id })),
        skipDuplicates: true,
      }),
    ]);

    return { ok: true, batchId: lote.id };
  } catch (err) {
    console.error("[cargar] fallo al guardar el borrador:", err);
    return { ok: false, error: "No se pudo guardar el borrador. Intenta de nuevo." };
  }
}

export async function loadBatch(batchId: unknown): Promise<LoadResult> {
  await requireSession();
  const id = z.string().min(1).safeParse(batchId);
  if (!id.success) return { ok: false, error: "Lote invalido" };

  try {
    const lote = await prisma.productImportBatch.findUnique({
      where: { id: id.data },
      include: { rows: { orderBy: { rowIndex: "asc" } } },
    });
    if (!lote) return { ok: false, error: "Ese lote ya no existe" };

    return {
      ok: true,
      batch: {
        id: lote.id,
        name: lote.name,
        status: lote.status,
        rows: lote.rows.map(
          (r): ImportRowDraft => ({
            id: r.id,
            // El id de Postgres sirve de identidad estable en el navegador.
            clientId: r.id,
            rowIndex: r.rowIndex,
            name: r.name,
            productType: r.productType as ProductType,
            isStorable: r.isStorable,
            qtyOnHand: r.qtyOnHand,
            salePrice: r.salePrice,
            cost: r.cost,
            purchaseTaxIds: r.purchaseTaxIds,
            categoryId: r.categoryId,
            imageUrl: r.imageUrl,
            imageData: r.imageData,
            isPublished: r.isPublished,
            publicCategoryIds: r.publicCategoryIds,
            showAvailability: r.showAvailability,
            supplierPartnerId: r.supplierPartnerId,
            status: r.status,
            odooTemplateId: r.odooTemplateId,
            error: r.error,
            warning: r.warning,
          })
        ),
      },
    };
  } catch (err) {
    console.error("[cargar] fallo al leer el borrador:", err);
    return { ok: false, error: "No se pudo leer el borrador." };
  }
}
