import { timingSafeEqual } from "node:crypto";

/**
 * true si la request trae `Authorization: Bearer ${CRON_SECRET}`, que es como
 * Vercel Cron firma sus llamadas.
 *
 * Sin CRON_SECRET configurado devuelve false siempre: comparar contra
 * `Bearer ${undefined}` aceptaria el texto literal "Bearer undefined". La
 * variable solo existe en Production, asi que en Preview y en local ninguna
 * request cuenta como cron.
 */
export function isCronRequest(req: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const received = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
