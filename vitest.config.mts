import { defineConfig } from "vitest/config";

// Solo logica pura: nada de React, base de datos ni Odoo. Por eso el entorno
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
