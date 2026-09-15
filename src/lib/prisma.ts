import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Desde Prisma 7 la conexion la maneja el driver `pg`, que no lee los
 * parametros de Prisma en la URL ni comparte sus valores por defecto. Aqui se
 * replican los de Prisma 6 para que la migracion no cambie el comportamiento:
 *
 * - Tamano del pool: `connection_limit` de DATABASE_URL, que es de donde lo
 *   tomaba Prisma 6. Sin el parametro queda el valor de `pg` (10).
 * - TLS: Prisma 6 cifraba si el servidor lo ofrecia y no validaba el
 *   certificado. `pg` sin `ssl` conecta en texto plano.
 * - Espera: Prisma 6 cortaba a los 5 s al conectar y a los 10 s esperando una
 *   conexion libre; `pg` por defecto espera para siempre.
 *
 * Fuera de este archivo hay un requisito en la base: el rol `postgres` tiene
 * `extra_float_digits = 3`. Supabase trae 0, y `pg` lee los resultados como
 * texto, asi que cada Float llegaba redondeado a 15 digitos (Prisma 6 los leia
 * en binario). Eso bastaba para que `Math.ceil` subiera en una unidad las
 * cantidades sugeridas. El pooler ignora los parametros de arranque, por eso
 * va en el rol y no aqui. Se revierte con
 * `ALTER ROLE postgres RESET extra_float_digits`.
 */
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  const connectionLimit = connectionString
    ? Number(new URL(connectionString).searchParams.get("connection_limit")) || undefined
    : undefined;

  const adapter = new PrismaPg({
    connectionString,
    max: connectionLimit,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
