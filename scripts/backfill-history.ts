/**
 * Trae la historia de ventas de Odoo a los snapshots de Utilia.
 *
 * El sync incremental solo hace backfill del mes anterior en su primera
 * corrida, asi que sin esto no hay con que comparar temporadas. Se corre a
 * mano, una vez, y despues cuando haga falta reconstruir.
 *
 *   npm run backfill                 → desde enero de 2025
 *   npm run backfill -- 2025-06      → desde junio de 2025
 */
import { backfillSalesHistory } from "../src/lib/sync";

async function main() {
  const arg = process.argv[2];
  const desde = arg ? new Date(`${arg}-01T00:00:00Z`) : new Date("2025-01-01T00:00:00Z");
  if (Number.isNaN(desde.getTime())) {
    console.error(`Fecha invalida: "${arg}". Usa el formato YYYY-MM.`);
    process.exit(1);
  }

  console.log(`Backfill desde ${desde.toISOString().slice(0, 7)}\n`);
  console.log("mes        ordenes   dias      ingreso");
  const t0 = Date.now();

  const meses = await backfillSalesHistory(desde, new Date(), (m) => {
    console.log(
      `${m.month}   ${String(m.orders).padStart(6)}  ${String(m.days).padStart(5)}   ${(m.revenue / 1e6).toFixed(1).padStart(8)}M`
    );
  });

  const totalOrdenes = meses.reduce((s, m) => s + m.orders, 0);
  const totalDias = meses.reduce((s, m) => s + m.days, 0);
  console.log(`\n${meses.length} meses · ${totalOrdenes} ordenes · ${totalDias} dias con venta · ${Math.round((Date.now() - t0) / 1000)}s`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Fallo el backfill:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
