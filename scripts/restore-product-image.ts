/**
 * Devuelve a Odoo la foto original de una ficha reparada, desde el respaldo
 * en Postgres (la fila mas antigua del template: la foto de antes de la
 * primera reparacion). Escribe en Odoo: correrlo es una decision de Henry.
 *
 * Uso: tsx --env-file=.env.local scripts/restore-product-image.ts <templateId>
 */
import { prisma } from "../src/lib/prisma";
import { writeTemplateImage } from "../src/lib/products/odoo-catalog-write";

(async () => {
  const templateId = Number(process.argv[2]);
  if (!Number.isInteger(templateId) || templateId <= 0) throw new Error("Falta el id del template");

  const respaldo = await prisma.productImageBackup.findFirst({
    where: { odooTemplateId: templateId },
    orderBy: { createdAt: "asc" },
  });
  if (!respaldo) throw new Error(`No hay respaldo para el template ${templateId}`);

  await writeTemplateImage(templateId, respaldo.imageBase64);
  console.log(`Foto original del template ${templateId} restaurada (respaldo del ${respaldo.createdAt.toISOString()})`);
  await prisma.$disconnect();
})();
