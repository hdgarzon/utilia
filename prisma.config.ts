import { defineConfig } from "prisma/config";

// Prisma 7 ya no carga archivos .env. La app los recibe de Next (y los scripts
// con `tsx --env-file`); la CLI los carga aqui. En Vercel las variables ya
// vienen en el entorno y no hay archivo: por eso el try.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // no existe: seguir con lo que haya en el entorno
  }
}

const directUrl = process.env.DIRECT_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  // La CLI (migraciones, db push, studio) va directo a Postgres; la app pasa
  // por el pooler desde src/lib/prisma.ts. `prisma generate` no se conecta, y
  // en una instalacion sin la variable (CI, Dependabot) no debe fallar.
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
