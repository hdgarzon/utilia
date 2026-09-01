import { prisma } from "@/lib/prisma";
import { odoo } from "@/lib/odoo";
import { Prisma } from "@prisma/client";

/**
 * Crea proveedores a partir del historial de compras sincronizado. Idempotente:
 * upsert por odooPartnerId. El nombre se refresca desde Odoo (partnerName);
 * el teléfono NUNCA se toca aquí (es dato capturado a mano en Utilia).
 */
export async function ensureSuppliersFromHistory(): Promise<number> {
  const partners = await prisma.$queryRaw<Array<{ odooPartnerId: number; partnerName: string | null }>>`
    SELECT DISTINCT ON ("odooPartnerId") "odooPartnerId", "partnerName"
    FROM "PurchaseOrder"
    WHERE "odooPartnerId" IS NOT NULL
    ORDER BY "odooPartnerId", "dateOrder" DESC
  `;

  let created = 0;
  for (const p of partners) {
    const name = p.partnerName ?? `Proveedor ${p.odooPartnerId}`;
    try {
      const existing = await prisma.supplier.findUnique({ where: { odooPartnerId: p.odooPartnerId } });
      if (!existing) {
        await prisma.supplier.create({ data: { name, odooPartnerId: p.odooPartnerId } });
        created++;
      } else if (existing.name !== name) {
        await prisma.supplier.update({ where: { id: existing.id }, data: { name } });
      }
    } catch (err) {
      // Colisión por nombre duplicado (name es @unique): se conserva el existente.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Ignorar violación de restricción única; conservar existente.
      } else {
        throw err;
      }
    }
  }
  return created;
}

/**
 * Trae los contactos proveedor de Odoo y completa el directorio: crea los que
 * falten, VINCULA los creados a mano en Utilia que coincidan por nombre (ver
 * abajo) y rellena el teléfono SOLO si está vacío (no pisa capturas manuales).
 */
export async function importSuppliersFromOdoo(): Promise<{ created: number; phonesFilled: number; linked: number }> {
  const odooSuppliers = await odoo.getSuppliers();
  let created = 0;
  let phonesFilled = 0;
  let linked = 0;

  for (const s of odooSuppliers) {
    const phone = typeof s.phone === "string" && s.phone ? s.phone : null;
    try {
      const existing = await prisma.supplier.findUnique({ where: { odooPartnerId: s.id } });
      if (existing) {
        if (!existing.phone && phone) {
          await prisma.supplier.update({ where: { id: existing.id }, data: { phone } });
          phonesFilled++;
        }
        continue;
      }

      // Sin vínculo por odooPartnerId todavía: puede ser un proveedor creado
      // a mano en Utilia (botón "Crear proveedor") cuyo nombre coincide con
      // este contacto de Odoo. Si es así, se ADOPTA (se vincula) en vez de
      // intentar crear uno nuevo -- un create acá chocaría con el nombre
      // único (P2002 más abajo) y el proveedor se quedaría sin vínculo para
      // siempre, cerrando el ciclo de escritura a Odoo para ese proveedor.
      const byName = await prisma.supplier.findUnique({ where: { name: s.name } });
      if (byName && byName.odooPartnerId === null) {
        const fillPhone = !byName.phone && phone;
        await prisma.supplier.update({
          where: { id: byName.id },
          data: { odooPartnerId: s.id, phone: fillPhone ? phone : undefined },
        });
        linked++;
        if (fillPhone) phonesFilled++;
        continue;
      }

      await prisma.supplier.create({ data: { name: s.name, odooPartnerId: s.id, phone } });
      created++;
      if (phone) phonesFilled++;
    } catch (err) {
      // Colisión por nombre duplicado: carrera genuina (p. ej. dos
      // importaciones a la vez); se conserva el existente.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Ignorar violación de restricción única; conservar existente.
      } else {
        throw err;
      }
    }
  }
  return { created, phonesFilled, linked };
}
