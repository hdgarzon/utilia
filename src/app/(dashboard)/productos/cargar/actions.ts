"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  MAX_IMAGE_BASE64_BYTES,
  MAX_ROWS_PER_BATCH,
  CREATE_SLICE_SIZE,
  type ImportRowDraft,
  type ImportProgress,
} from "@/lib/products/import-types";
import type { ProductType } from "@/lib/products/types";
import { createTemplate } from "@/lib/products/odoo-catalog-write";
import { translateOdooError } from "@/lib/odoo-write";

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
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const { batchId, name, rows } = parsed.data;

  try {
    const lote = batchId
      ? await prisma.productImportBatch.update({ where: { id: batchId }, data: { name } })
      : await prisma.productImportBatch.create({
          data: { name, createdBy: session.user?.id ?? null },
        });

    const insertadas = await prisma.$transaction(async (tx) => {
      // Las filas ya creadas en Odoo se conservan tal cual.
      await tx.productImportRow.deleteMany({
        where: { batchId: lote.id, status: { not: "OK" } },
      });
      const { count } = await tx.productImportRow.createMany({
        data: rows.map((r) => ({ ...r, batchId: lote.id })),
        skipDuplicates: true,
      });
      return count;
    });

    // Cualquier fila entrante que caiga sobre el indice de una ya creada en
    // Odoo es un choque, sin excepcion: `saveBatch` solo se llama mientras el
    // lote esta en borrador, y en borrador no existen filas OK. Si llega una,
    // es un bug de la UI, y hay que gritarlo -- no tragarselo.
    //
    // Contar y comparar NO sirve aqui: una fila distinta sentada en un indice
    // OK se salta igual que la fila OK reenviada, la aritmetica se equilibra
    // y el choque pasa desapercibido. Verificado empiricamente.
    if (insertadas < rows.length) {
      return {
        ok: false,
        error:
          "Algunas filas chocan con productos que ya se crearon en Odoo. Cierra este lote y empieza uno nuevo con las que falten.",
      };
    }

    return { ok: true, batchId: lote.id };
  } catch (err) {
    console.error("[cargar] fallo al guardar el borrador:", err);
    // P2025: el lote ya no existe. Reintentar con el mismo id fallaria igual,
    // asi que no hay que decirle al usuario que lo intente de nuevo.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "Ese lote ya no existe. Empieza uno nuevo." };
    }
    return { ok: false, error: "No se pudo guardar el borrador. Intenta de nuevo." };
  }
}

export async function loadBatch(batchId: unknown): Promise<LoadResult> {
  await requireSession();
  const id = z.string().min(1).safeParse(batchId);
  if (!id.success) return { ok: false, error: "Lote inválido" };

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

type CreateResult = { ok: boolean; error?: string; progress?: ImportProgress };

/** Tope para bajar una imagen por link. Corto a proposito: una imagen lenta
 *  no debe consumir el presupuesto de toda la tanda. */
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

/**
 * Crea UNA tanda de filas pendientes y devuelve el progreso. El cliente la
 * vuelve a llamar hasta que `done` sea true.
 *
 * Cada fila se marca OK o ERROR inmediatamente despues de su create, asi que
 * un corte a mitad no duplica productos: al reintentar solo se toman las que
 * no quedaron OK.
 */
export async function createBatchSlice(batchId: unknown): Promise<CreateResult> {
  await requireSession();
  const id = z.string().min(1).safeParse(batchId);
  if (!id.success) return { ok: false, error: "Lote inválido" };

  try {
    await prisma.productImportBatch.update({
      where: { id: id.data },
      data: { status: "CREATING" },
    });

    const pendientes = await prisma.productImportRow.findMany({
      where: { batchId: id.data, status: { not: "OK" } },
      orderBy: { rowIndex: "asc" },
      take: CREATE_SLICE_SIZE,
    });

    for (const fila of pendientes) {
      let warning: string | null = null;
      let imagen: string | null = fila.imageData;

      if (!imagen && fila.imageUrl) {
        try {
          imagen = await descargarImagen(fila.imageUrl);
        } catch (err) {
          // Una imagen rota no debe costar el producto.
          console.error(`[cargar] no se pudo bajar la imagen de la fila ${fila.rowIndex}:`, err);
          warning = "El producto se creó sin imagen: el link no se pudo descargar";
        }
      }

      try {
        const odooTemplateId = await createTemplate(
          {
            name: fila.name,
            productType: fila.productType as ProductType,
            isStorable: fila.isStorable,
            qtyOnHand: fila.qtyOnHand,
            salePrice: fila.salePrice,
            cost: fila.cost,
            purchaseTaxIds: fila.purchaseTaxIds,
            categoryId: fila.categoryId,
            imageUrl: fila.imageUrl,
            imageData: fila.imageData,
            isPublished: fila.isPublished,
            publicCategoryIds: fila.publicCategoryIds,
            showAvailability: fila.showAvailability,
            supplierPartnerId: fila.supplierPartnerId,
          },
          imagen
        );

        // Se marca OK y se suelta el base64 en el mismo update: un lote
        // terminado no debe arrastrar imagenes en Postgres.
        await prisma.productImportRow.update({
          where: { id: fila.id },
          data: { status: "OK", odooTemplateId, error: null, warning, imageData: null },
        });
      } catch (err) {
        await prisma.productImportRow.update({
          where: { id: fila.id },
          data: { status: "ERROR", error: translateOdooError(err, "catalogo") },
        });
      }
    }

    const [okCount, errorCount, remaining] = await Promise.all([
      prisma.productImportRow.count({ where: { batchId: id.data, status: "OK" } }),
      prisma.productImportRow.count({ where: { batchId: id.data, status: "ERROR" } }),
      prisma.productImportRow.count({ where: { batchId: id.data, status: "PENDING" } }),
    ]);
    const done = remaining === 0;

    await prisma.productImportBatch.update({
      where: { id: id.data },
      data: { status: done ? (errorCount > 0 ? "PARTIAL" : "DONE") : "CREATING" },
    });

    return {
      ok: true,
      progress: { processed: pendientes.length, okCount, errorCount, remaining, done },
    };
  } catch (err) {
    console.error("[cargar] fallo la tanda de creacion:", err);
    // P2025: el lote ya no existe. Reintentar con el mismo id fallaria igual,
    // asi que no hay que decirle al usuario que lo intente de nuevo.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "Ese lote ya no existe. Empieza uno nuevo." };
    }
    return { ok: false, error: "No se pudo crear la tanda. Revisa la conexión con Odoo." };
  }
}

/** Baja una imagen por link y la devuelve en base64 sin prefijo `data:`. */
async function descargarImagen(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tipo = res.headers.get("content-type") ?? "";
  if (!tipo.startsWith("image/")) throw new Error(`No es una imagen: ${tipo}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 5_000_000) throw new Error("La imagen pesa más de 5 MB");
  return Buffer.from(buf).toString("base64");
}
