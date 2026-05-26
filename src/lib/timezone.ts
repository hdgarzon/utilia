/**
 * Utilidades de timezone para Colombia (UTC-5, sin horario de verano).
 *
 * El servidor de Vercel corre en UTC. Después de las 7pm Colombia (=medianoche UTC)
 * `new Date()` ya apunta al día siguiente, rompiendo lookups de snapshots diarios
 * y cálculos de mes/año. Usar siempre estas funciones en código server-side.
 */

export const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC-5

/**
 * Retorna "hoy" en Colombia como Date UTC-midnight.
 * Ej: 8pm Colombia (1am UTC día siguiente) → devuelve el día Colombia correcto.
 */
export function colombiaToday(): Date {
  const nowCO = new Date(Date.now() - COLOMBIA_OFFSET_MS);
  return new Date(Date.UTC(nowCO.getUTCFullYear(), nowCO.getUTCMonth(), nowCO.getUTCDate()));
}

/** Año, mes (1-12) y día actuales en Colombia. */
export function colombiaYearMonthDay(): { year: number; month: number; day: number } {
  const nowCO = new Date(Date.now() - COLOMBIA_OFFSET_MS);
  return {
    year: nowCO.getUTCFullYear(),
    month: nowCO.getUTCMonth() + 1,
    day: nowCO.getUTCDate(),
  };
}

/** Retorna la fecha de N días antes de hoy (Colombia). */
export function colombiaDaysAgo(days: number): Date {
  return new Date(colombiaToday().getTime() - days * 86_400_000);
}
