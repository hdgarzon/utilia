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

/**
 * Dia calendario en Colombia (YYYY-MM-DD) de una fecha cualquiera, no solo
 * "ahora". Mismo desplazamiento que colombiaToday(), para poder comparar si
 * dos timestamps -por ejemplo, dos fotos de un verificador- cayeron en el
 * mismo dia Colombia o no.
 */
export function colombiaDayString(date: Date): string {
  const co = new Date(date.getTime() - COLOMBIA_OFFSET_MS);
  return new Date(Date.UTC(co.getUTCFullYear(), co.getUTCMonth(), co.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/**
 * Fecha y hora en Colombia, para mostrar: "2026-09-08 14:32".
 *
 * Existe para no dejar que un componente formatee la hora por su cuenta. Un
 * `toLocaleString()` en el navegador usa la zona de QUIEN mira, no la de la
 * tienda: el mismo lote saldria con una hora distinta segun el dispositivo, y
 * despues de las 7pm Colombia hasta con otro dia.
 */
export function colombiaDateTimeString(date: Date): string {
  const co = new Date(date.getTime() - COLOMBIA_OFFSET_MS);
  const dosDigitos = (n: number) => String(n).padStart(2, "0");
  return (
    `${colombiaDayString(date)} ` +
    `${dosDigitos(co.getUTCHours())}:${dosDigitos(co.getUTCMinutes())}`
  );
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

/**
 * Retorna el primer día del mes actual en Colombia (medianoche UTC).
 * Ej: cualquier momento de mayo → 2026-05-01T00:00:00.000Z
 * Usar para rangos MTD (Month-to-Date) en vez de rolling 30 días.
 */
export function colombiaStartOfMonth(): Date {
  const { year, month } = colombiaYearMonthDay();
  return new Date(Date.UTC(year, month - 1, 1));
}

/**
 * Dia calendario Colombia de un instante, como Date a medianoche UTC (el mismo
 * formato de las columnas DATE). Ej: 2026-09-09T01:30Z (8:30pm del 8 en
 * Colombia) → 2026-09-08T00:00Z.
 */
export function colombiaDayOf(instant: Date): Date {
  return new Date(`${colombiaDayString(instant)}T00:00:00.000Z`);
}

/**
 * Instante real en que empezo el dia Colombia de `instant` (medianoche Colombia
 * = 05:00 UTC). Sirve para pedirle a Odoo "todo lo de ese dia", que filtra por
 * timestamp UTC y no por dia calendario.
 */
export function colombiaDayStartInstant(instant: Date): Date {
  return new Date(colombiaDayOf(instant).getTime() + COLOMBIA_OFFSET_MS);
}

// ─── Calendario de fechas DATE (medianoche UTC) ─────────────────────────────
// Las columnas `@db.Date` llegan como medianoche UTC. Estas funciones operan
// en UTC puro para no correr el dia en servidores con otra zona horaria.

/** Dias que tiene el mes (`month` 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Primer dia del mes como Date a medianoche UTC. */
export function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

/** Mes anterior, con el cambio de año resuelto. */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** Suma (o resta, con negativo) dias a una fecha DATE. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Dias calendario de `from` a `to` (0 si son el mismo dia, negativo si `to` es anterior). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** "YYYY-MM-DD" de una fecha DATE (medianoche UTC). */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Primer día del MES ANTERIOR en Colombia (medianoche UTC).
 * Ej: cualquier momento de junio → 2026-05-01T00:00:00.000Z.
 * Date.UTC maneja el rollover de año si month-2 es negativo (enero → diciembre).
 * Se usa como ventana de backfill del sync: cubre mes actual + mes anterior
 * (suficiente para el comparativo mensual) sin traer 90 días de órdenes.
 */
export function colombiaStartOfPreviousMonth(): Date {
  const { year, month } = colombiaYearMonthDay();
  return new Date(Date.UTC(year, month - 2, 1));
}
