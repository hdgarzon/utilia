"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  MAX_IMAGE_BASE64_BYTES,
  MAX_ROWS_PER_BATCH,
  CREATE_SLICE_SIZE,
  ESTADO_POR_INTENTAR,
  ESTADOS_REENCOLABLES,
  ESTADOS_BORRABLES,
  type ImportRowDraft,
  type ImportProgress,
} from "@/lib/products/import-types";
import type { ProductType } from "@/lib/products/types";
import { createTemplate, createOrderpoint } from "@/lib/products/odoo-catalog-write";
import { translateOdooError } from "@/lib/odoo-write";

/**
 * Una fila puede juntar mas de una advertencia (imagen rota Y regla fallida).
 * Sin esto la segunda pisaba a la primera y el dueño solo veia una.
 */
function juntarAvisos(previo: string | null, nuevo: string): string {
  return previo ? `${previo}. ${nuevo}` : nuevo;
}

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
  stockMin: z.number().nonnegative().nullable(),
  stockMax: z.number().nonnegative().nullable(),
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
  availableInPos: z.boolean(),
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
      // Se borra por lista blanca, NO con `not: "OK"`. Una fila en CREATING
      // tambien puede tener un producto vivo en Odoo, y con `not: "OK"` se
      // borraba y volvia a entrar como PENDING -- es decir, se recreaba.
      await tx.productImportRow.deleteMany({
        where: { batchId: lote.id, status: { in: [...ESTADOS_BORRABLES] } },
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
            stockMin: r.stockMin,
            stockMax: r.stockMax,
            salePrice: r.salePrice,
            cost: r.cost,
            purchaseTaxIds: r.purchaseTaxIds,
            categoryId: r.categoryId,
            imageUrl: r.imageUrl,
            imageData: r.imageData,
            isPublished: r.isPublished,
            publicCategoryIds: r.publicCategoryIds,
            showAvailability: r.showAvailability,
            availableInPos: r.availableInPos,
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
 * Cada fila se crea en DOS FASES, y ese es el unico motivo por el que un
 * reintento no puede duplicar un producto:
 *
 *   1. Se RECLAMA la fila en Postgres (PENDING -> CREATING) ANTES de llamar a
 *      Odoo. Si este update falla, nunca se llamo a Odoo: no hay nada creado
 *      y la fila se queda PENDING, intacta y reintentable.
 *   2. Se llama a Odoo, y solo cuando el id vuelve y se registra la fila pasa
 *      a OK.
 *
 * Lo que quede en medio -- llamada hecha, resultado sin confirmar aqui -- se
 * queda en CREATING, y a CREATING no lo toma NADIE: ni esta funcion (que
 * selecciona PENDING), ni `retryFailedRows` (que selecciona ERROR), ni
 * `saveBatch` (que borra PENDING y ERROR). Sale de ahi una persona, mirando
 * Odoo.
 *
 * Esto cubre el corte a mitad y tambien la muerte del proceso. Antes, una
 * fila cuyo producto YA existia en Odoo pero cuyo registro local no se pudo
 * guardar se quedaba en PENDING -- indistinguible de una que nunca se intento
 * -- y la siguiente tanda, o un "Reintentar" corriente sobre otra fila rota,
 * la volvia a mandar a `createTemplate` y creaba el producto por segunda vez.
 * Ahora ese caso degrada a una fila que hay que revisar, nunca a un duplicado.
 *
 * El reclamo es ademas un candado: `updateMany` con `status: PENDING` en el
 * where se resuelve en un solo statement, asi que dos pestañas creando el
 * mismo lote a la vez no pueden llevarse la misma fila -- la segunda cuenta 0
 * y la salta.
 *
 * Queda UNA ventana irreducible, la de siempre: si Odoo crea el producto pero
 * la respuesta se pierde, `createTemplate` lanza y la fila se marca ERROR
 * como cualquier otro fallo. No se puede distinguir desde aqui sin una
 * transaccion que abarque los dos sistemas.
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

    // SOLO las que nunca se intentaron. Las que fallaron se vuelven a poner
    // en PENDING desde `retryFailedRows`, y nunca antes.
    //
    // Con un `status: { not: "OK" }` ordenado por rowIndex, veinte filas rotas
    // al principio de la hoja se re-seleccionan en cada tanda y las pendientes
    // no se tocan JAMAS: el bucle agota sus vueltas, la pantalla dice
    // "terminado" y 180 de 200 filas quedan sin intentar sin que nadie avise.
    const pendientes = await prisma.productImportRow.findMany({
      where: { batchId: id.data, status: ESTADO_POR_INTENTAR },
      orderBy: { rowIndex: "asc" },
      take: CREATE_SLICE_SIZE,
    });

    // Producto creado en Odoo cuya fila no se pudo confirmar aqui ni con el
    // update completo ni con el minimo. Corta la tanda y viaja al cliente
    // para que el dueño lo revise antes de que nadie vuelva a intentar.
    let plantillaSinConfirmar: number | null = null;

    for (const fila of pendientes) {
      // FASE 1 -- reclamar la fila ANTES de tocar Odoo. El `status` en el
      // where hace el update atomico: si otra invocacion ya se la llevo,
      // `count` es 0 y esta la salta sin llamar a Odoo.
      try {
        const { count } = await prisma.productImportRow.updateMany({
          where: { id: fila.id, status: ESTADO_POR_INTENTAR },
          data: { status: "CREATING" },
        });
        if (count === 0) continue;
      } catch (err) {
        // No se pudo reclamar => no se llamo a Odoo => no hay nada creado y
        // la fila sigue PENDING. Se corta: si Postgres no responde, seguir
        // solo gasta llamadas a Odoo que tampoco se van a poder registrar.
        console.error(`[cargar] no se pudo reclamar la fila ${fila.rowIndex}:`, err);
        break;
      }

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

      // FASE 2 -- crear en Odoo. La fila ya esta reclamada: si esto no llega
      // a devolver, se queda en CREATING y nadie la vuelve a tomar.
      let odooTemplateId: number;
      try {
        odooTemplateId = await createTemplate(
          {
            name: fila.name,
            productType: fila.productType as ProductType,
            isStorable: fila.isStorable,
            qtyOnHand: fila.qtyOnHand,
            stockMin: fila.stockMin,
            stockMax: fila.stockMax,
            salePrice: fila.salePrice,
            cost: fila.cost,
            purchaseTaxIds: fila.purchaseTaxIds,
            categoryId: fila.categoryId,
            imageUrl: fila.imageUrl,
            imageData: fila.imageData,
            isPublished: fila.isPublished,
            publicCategoryIds: fila.publicCategoryIds,
            showAvailability: fila.showAvailability,
            availableInPos: fila.availableInPos,
            supplierPartnerId: fila.supplierPartnerId,
          },
          imagen
        );
      } catch (err) {
        // `createTemplate` lanzo: no hay producto que duplicar, asi que
        // devolver la fila al circuito como ERROR es seguro.
        try {
          await prisma.productImportRow.update({
            where: { id: fila.id },
            data: { status: "ERROR", error: translateOdooError(err, "catalogo") },
          });
        } catch (err2) {
          // Postgres tampoco responde. La fila se queda en CREATING: es de
          // mas -- no hay producto en Odoo -- pero prefiero una fila que hay
          // que revisar a mano antes que una que se reintenta a ciegas.
          console.error(`[cargar] no se pudo marcar ERROR la fila ${fila.rowIndex}:`, err2);
          break;
        }
        continue;
      }

      // La regla de reabastecimiento va DESPUES del producto y su fallo no
      // puede costarlo: se anota como advertencia y la fila sigue OK. Marcar
      // ERROR aqui mandaria la fila al reintento y crearia el producto por
      // segunda vez -- quedarse sin la regla es mucho menos grave.
      if (fila.stockMin !== null && fila.stockMax !== null) {
        try {
          await createOrderpoint(odooTemplateId, fila.stockMin, fila.stockMax);
        } catch (err) {
          console.error(
            `[cargar] no se pudo crear la regla de reabastecimiento de la fila ${fila.rowIndex} ` +
              `(producto ${odooTemplateId}):`,
            err
          );
          warning = juntarAvisos(
            warning,
            "El producto se creó sin mínimos y máximos: la regla de reabastecimiento falló"
          );
        }
      }

      // A partir de aqui el producto YA EXISTE en Odoo. Si el registro local
      // falla, marcar la fila ERROR seria mentir y garantizaria un duplicado
      // al reintentar: hay que insistir en dejarla OK.
      //
      // Se suelta el base64 en el mismo update: un lote terminado no debe
      // arrastrar imagenes en Postgres.
      try {
        await prisma.productImportRow.update({
          where: { id: fila.id },
          data: { status: "OK", odooTemplateId, error: null, warning, imageData: null },
        });
      } catch (err) {
        console.error(
          `[cargar] el producto ${odooTemplateId} SI se creo en Odoo pero no se pudo registrar la fila ${fila.rowIndex}:`,
          err
        );
        try {
          // Segundo intento minimo: lo unico que importa es que no se recree.
          // Se repiten warning e imageData: null -- sin ellos, una fila
          // rescatada por este camino se queda con el aviso de imagen viejo
          // y con el base64 completo pegado en Postgres para siempre.
          await prisma.productImportRow.update({
            where: { id: fila.id },
            data: { status: "OK", odooTemplateId, warning, imageData: null },
          });
        } catch (err2) {
          // Doble fallo: el producto YA EXISTE en Odoo (el id es real) pero
          // ni el update completo ni el minimo se pudieron guardar aqui.
          //
          // No hay que hacer nada mas para que sea seguro: la fila ya quedo
          // en CREATING al reclamarla, y ese estado no lo selecciona ninguna
          // consulta. Se corta la tanda y se avisa fuerte con el id de Odoo
          // para que el dueño reconcilie a mano.
          console.error(
            `[cargar] DOBLE FALLO registrando la fila ${fila.rowIndex} del lote ${id.data}: ` +
              `el producto ${odooTemplateId} se creo en Odoo pero ni el update completo ni el minimo ` +
              `se pudieron guardar en Postgres. La fila queda en CREATING y no se reintenta sola. ` +
              `Requiere reconciliacion manual en Odoo y en la base de datos.`,
            err2
          );
          plantillaSinConfirmar = odooTemplateId;
          break;
        }
      }
    }

    if (plantillaSinConfirmar !== null) {
      return {
        ok: false,
        error: `Se creó el producto ${plantillaSinConfirmar} en Odoo pero no se pudo registrar aquí. Revísalo en Odoo: esa fila queda marcada como sin confirmar y no se va a reintentar sola.`,
      };
    }

    const [okCount, errorCount, remaining, unconfirmedCount] = await Promise.all([
      prisma.productImportRow.count({ where: { batchId: id.data, status: "OK" } }),
      prisma.productImportRow.count({ where: { batchId: id.data, status: "ERROR" } }),
      prisma.productImportRow.count({ where: { batchId: id.data, status: ESTADO_POR_INTENTAR } }),
      prisma.productImportRow.count({ where: { batchId: id.data, status: "CREATING" } }),
    ]);

    // `done` significa "no queda trabajo que este bucle pueda hacer", no "el
    // lote salio perfecto". Una fila en CREATING no se reintenta sola, asi
    // que NO cuenta como trabajo pendiente: si contara, el cliente giraria en
    // vacio hasta agotar sus vueltas. Quien avisa de ella es `unconfirmedCount`.
    const done = remaining === 0;

    await prisma.productImportBatch.update({
      where: { id: id.data },
      data: {
        status: !done
          ? "CREATING"
          : errorCount > 0 || unconfirmedCount > 0
            ? "PARTIAL"
            : "DONE",
      },
    });

    return {
      ok: true,
      progress: { processed: pendientes.length, okCount, errorCount, remaining, unconfirmedCount, done },
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

/**
 * Devuelve las filas fallidas al estado PENDING para que `createBatchSlice`
 * las vuelva a tomar. Es el unico camino por el que una fila en ERROR se
 * reintenta: asi cada tanda siempre avanza sobre filas nuevas y el bucle no
 * puede quedarse girando sobre las mismas veinte rotas.
 *
 * SOLO ERROR, por lista blanca. Una fila en CREATING salio de aqui con una
 * llamada a Odoo hecha y sin confirmar: reencolarla crearia el producto por
 * segunda vez. Es lo que hacia antes, cuando esa fila se quedaba en PENDING
 * y bastaba un "Reintentar" corriente -- ni siquiera dirigido a ella -- para
 * duplicarla.
 */
export async function retryFailedRows(
  batchId: unknown
): Promise<{ ok: boolean; error?: string; reintentadas?: number }> {
  await requireSession();
  const id = z.string().min(1).safeParse(batchId);
  if (!id.success) return { ok: false, error: "Lote inválido" };

  try {
    const { count } = await prisma.productImportRow.updateMany({
      where: { batchId: id.data, status: { in: [...ESTADOS_REENCOLABLES] } },
      data: { status: ESTADO_POR_INTENTAR, error: null },
    });
    return { ok: true, reintentadas: count };
  } catch (err) {
    console.error("[cargar] fallo al reencolar las filas con error:", err);
    return { ok: false, error: "No se pudieron reencolar las filas que fallaron." };
  }
}

/** Baja una imagen por link y la devuelve en base64 sin prefijo `data:`. */
async function descargarImagen(url: string): Promise<string> {
  // `esHttpUrl` en import-schema.ts solo corre en el navegador al validar la
  // hoja. Sin repetir el chequeo aqui, en el servidor, un link guardado por
  // otra via (o un borrador viejo de antes de esa validacion) llegaria
  // intacto hasta este fetch con cualquier esquema -- file:, ftp:, etc.
  const esquema = new URL(url).protocol;
  if (esquema !== "http:" && esquema !== "https:") {
    throw new Error(`Esquema no permitido: ${esquema}`);
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tipo = res.headers.get("content-type") ?? "";
  if (!tipo.startsWith("image/")) throw new Error(`No es una imagen: ${tipo}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 5_000_000) throw new Error("La imagen pesa más de 5 MB");
  return Buffer.from(buf).toString("base64");
}
