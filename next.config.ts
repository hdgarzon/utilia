import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma", "bcryptjs"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.odoo.com" },
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  experimental: {
    serverActions: {
      // Next trae 1 MB por defecto, que ya no alcanza: `saveBatch` (ver
      // src/app/(dashboard)/productos/cargar/actions.ts) manda la hoja
      // completa -- hasta MAX_ROWS_PER_BATCH filas -- en una sola llamada, y
      // cada imagen adjunta pesa hasta MAX_IMAGE_BASE64_BYTES (500.000 bytes,
      // src/lib/products/import-types.ts) una vez reducida en el navegador.
      // Dos imagenes ya superan 1 MB.
      //
      // 500.000 x 8 = 4.000.000 bytes. Ocho es un techo realista para un
      // lote: las imagenes solo entran por carga manual desde el computador
      // (el CSV solo trae un link, que se descarga en el servidor y nunca
      // pasa por este body), asi que aunque la hoja tenga 200 filas de texto
      // es raro que mas de un puñado traigan foto adjunta a mano. El numero
      // exacto en bytes evita la ambiguedad de si "mb" en Next cuenta 1000 o
      // 1024, y deja margen bajo el techo duro de 4.5 MB que Vercel impone a
      // nivel de plataforma para funciones serverless (ese no se puede subir
      // desde configuracion) para el resto del payload -- las 200 filas de
      // texto y el JSON que las envuelve.
      bodySizeLimit: 4_000_000,
    },
  },
};

export default nextConfig;
