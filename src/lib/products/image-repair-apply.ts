import { prisma } from "@/lib/prisma";
import { translateOdooError } from "@/lib/odoo-write";
import { writeTemplateImage, esRechazoDeNegocio } from "./odoo-catalog-write";
import { repairImage } from "./image-repair";
import type { ImageRepairTarget } from "./image-repair-candidates";

/**
 * Aplica la reparacion a un lote ya seleccionado: procesa cada foto, guarda
 * la original en `ProductImageBackup` y solo entonces escribe la nueva en
 * Odoo. Lo usan la accion de Productos y nada mas que corra solo: nunca el
 * sync ni un cron.
 */

export interface ImageRepairDeps {
  backup: (row: { odooTemplateId: number; imageBase64: string; repairedSide: number; createdBy: string | null }) => Promise<unknown>;
  write: (templateId: number, imageBase64: string) => Promise<void>;
}

const depsReales: ImageRepairDeps = {
  backup: (data) => prisma.productImageBackup.create({ data }),
  write: writeTemplateImage,
};

export interface ImageRepairOutcome {
  written: number;
  failed: Array<{ templateId: number; name: string; error: string }>;
}

export async function applyImageRepairs(
  targets: ImageRepairTarget[],
  createdBy: string | null,
  deps: ImageRepairDeps = depsReales
): Promise<ImageRepairOutcome> {
  const failed: ImageRepairOutcome["failed"] = [];
  let written = 0;

  const cortar = (desde: number, error: string) => {
    for (const resto of targets.slice(desde)) {
      failed.push({ templateId: resto.templateId, name: resto.name, error });
    }
  };

  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i];

    let reparada: Awaited<ReturnType<typeof repairImage>>;
    try {
      reparada = await repairImage(t.original);
    } catch (err) {
      console.error(`[imagenes] no se pudo procesar la foto de ${t.templateId}:`, err);
      failed.push({ templateId: t.templateId, name: t.name, error: "No se pudo procesar la foto" });
      continue;
    }

    // Respaldo primero. Si Postgres falla no se escribe nada mas: sin
    // respaldo no hay como volver a la foto original.
    try {
      await deps.backup({
        odooTemplateId: t.templateId,
        imageBase64: t.original.toString("base64"),
        repairedSide: reparada.side,
        createdBy,
      });
    } catch (err) {
      console.error("[imagenes] fallo el respaldo, se corta la corrida:", err);
      cortar(i, "No se pudo respaldar la foto original; no se escribio");
      break;
    }

    try {
      await deps.write(t.templateId, reparada.base64);
      written += 1;
    } catch (err) {
      const mensaje = translateOdooError(err, "catalogo");
      if (!esRechazoDeNegocio(err)) {
        // Odoo no respondio: seguir seria repetir el mismo timeout por cada
        // ficha que queda. Se marca lo que falta como fallido y se corta.
        cortar(i, mensaje);
        break;
      }
      failed.push({ templateId: t.templateId, name: t.name, error: mensaje });
    }
  }

  return { written, failed };
}
