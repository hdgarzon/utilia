/**
 * Fuerza un re-sync COMPLETO de productos (resetea el cutoff a epoch) para
 * repoblar campos como `name` (ahora display_name de la variante).
 *   tsx --env-file=.env.local scripts/resync-products.ts
 */
import { prisma } from "@/lib/prisma";
import { syncProducts } from "@/lib/sync";

async function main() {
  await prisma.syncState.upsert({
    where: { entity: "product_template" },
    create: { entity: "product_template", lastSyncAt: new Date(0), status: "idle" },
    update: { lastSyncAt: new Date(0) },
  });
  const t0 = Date.now();
  const r = await syncProducts();
  console.log(`Re-sync productos: ${JSON.stringify(r)} en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
