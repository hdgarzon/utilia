import { prisma } from "@/lib/prisma";

export interface WeeklyDayStat {
  dow: number;           // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  dayName: string;       // "Lunes", "Martes", ...
  daysObserved: number;  // cuántos días de ese DOW están en el rango
  avgRevenue: number;
  avgTransactions: number;
  avgNetProfit: number;
  avgNetMarginPct: number;
  rank: number;          // 1 = más rentable, 7 = peor
  isWeakDay: boolean;    // true si margen promedio < 0 o ingresos en bottom 2
}

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/**
 * Agrega FinancialSnapshot por día de semana sobre una ventana de `days`.
 * Devuelve estadísticos por DOW + ranking.
 */
export async function getWeeklyPattern(days = 60): Promise<WeeklyDayStat[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Postgres: EXTRACT(DOW FROM ...) → 0=Sunday ... 6=Saturday
  const rows = await prisma.$queryRaw<
    Array<{
      dow: number;
      days_observed: bigint;
      avg_revenue: number | null;
      avg_txn: number | null;
      avg_net: number | null;
      avg_margin: number | null;
    }>
  >`
    SELECT
      EXTRACT(DOW FROM "date")::int          AS dow,
      COUNT(*)                                AS days_observed,
      AVG("totalRevenue")                     AS avg_revenue,
      AVG("transactionCount")::float          AS avg_txn,
      AVG("netProfit")                        AS avg_net,
      AVG("netMarginPct")                     AS avg_margin
    FROM "FinancialSnapshot"
    WHERE "date" >= ${since}
      AND "transactionCount" > 0
    GROUP BY EXTRACT(DOW FROM "date")
    ORDER BY dow ASC
  `;

  // Garantiza 7 días aún si algún DOW no aparece (no se opera ese día)
  const byDow = new Map<number, (typeof rows)[number]>();
  for (const r of rows) byDow.set(r.dow, r);

  const stats: WeeklyDayStat[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const r = byDow.get(dow);
    stats.push({
      dow,
      dayName: DAY_NAMES[dow],
      daysObserved: r ? Number(r.days_observed) : 0,
      avgRevenue: r?.avg_revenue ?? 0,
      avgTransactions: r?.avg_txn ?? 0,
      avgNetProfit: r?.avg_net ?? 0,
      avgNetMarginPct: r?.avg_margin ?? 0,
      rank: 0,
      isWeakDay: false,
    });
  }

  // Ranking por ingresos promedio (días sin observación quedan al final)
  const ranked = [...stats]
    .filter((s) => s.daysObserved > 0)
    .sort((a, b) => b.avgRevenue - a.avgRevenue);
  ranked.forEach((s, i) => {
    s.rank = i + 1;
  });

  // Marcar débiles: margen negativo, o ingresos en el bottom 2
  const observedSorted = ranked.length;
  for (const s of stats) {
    if (s.daysObserved === 0) continue;
    s.isWeakDay = s.avgNetMarginPct < 0 || s.rank > observedSorted - 2;
  }

  return stats;
}
