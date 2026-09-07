import type { NextConfig } from "next";
import { MAX_ACTION_BODY_BYTES } from "./src/lib/products/import-types";

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
      // cada imagen adjunta pesa hasta MAX_IMAGE_BASE64_BYTES (500.000 bytes)
      // una vez reducida en el navegador. Dos imagenes ya superan 1 MB.
      //
      // El numero vive en src/lib/products/import-types.ts y se importa: el
      // navegador tiene que cuchillar la hoja contra ESTE mismo tope antes de
      // enviarla (`revisarPesoImagenes`), porque un body pasado lo corta la
      // plataforma antes de que la accion exista y lo unico que se ve del
      // otro lado es un fallo de red. Dos copias del numero era pedir que se
      // separaran.
      //
      // El valor exacto en bytes evita la ambiguedad de si "mb" en Next
      // cuenta 1000 o 1024, y queda bajo el techo duro de 4,5 MB que Vercel
      // impone a nivel de plataforma para funciones serverless -- ese no se
      // puede subir desde configuracion.
      bodySizeLimit: MAX_ACTION_BODY_BYTES,
    },
  },
};

export default nextConfig;
