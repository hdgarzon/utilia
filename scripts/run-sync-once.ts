/**
 * Corre runFullSync() una vez contra la BD/Odoo configurados en .env.local.
 * Sirve para verificar el sync localmente y para desatascar producción.
 *
 *   tsx --env-file=.env.local scripts/run-sync-once.ts
 */
import { runFullSync } from "@/lib/sync";

async function main() {
  const t0 = Date.now();
  const results = await runFullSync();
  const labels = ["products", "stock", "sales", "purchases"];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      console.log(`OK  ${labels[i]}: synced ${r.value.synced}`);
    } else {
      console.error(`ERR ${labels[i]}:`, r.reason instanceof Error ? r.reason.message : r.reason);
    }
  });
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(results.some((r) => r.status === "rejected") ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
