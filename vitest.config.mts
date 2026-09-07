import { defineConfig } from "vitest/config";

// Nada sale del proceso: ni React, ni base de datos, ni Odoo. Casi todo lo
// que hay aqui es logica pura; lo poco que no lo es -- las server actions de
// la carga masiva -- corre contra Prisma y Odoo mockeados. Por eso el entorno
// es "node" y el include no alcanza componentes.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": `${import.meta.dirname}/src` },
  },
});
