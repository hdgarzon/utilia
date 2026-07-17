import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { odoo } from "@/lib/odoo";
import { renderEstado, type TemplateId } from "./templates";

export const runtime = "nodejs";

// El logo se lee una vez al cargar el módulo (archivo con espacio en el nombre).
const LOGO_BASE64 = readFileSync(join(process.cwd(), "public", "logo Utilia.jpg")).toString("base64");
const LOGO_SRC = `data:image/jpeg;base64,${LOGO_BASE64}`;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await prisma.statusPost.findUnique({ where: { id } });
  if (!post) return new Response("Not found", { status: 404 });

  // Odoo entrega las imágenes en WebP, que Satori (next/og) no decodifica.
  // Las normalizamos a PNG con sharp (que detecta el formato de entrada solo).
  const img = await odoo.getProductImage(post.odooProductId).catch(() => null);
  let photoSrc: string | null = null;
  if (img) {
    try {
      const png = await sharp(Buffer.from(img, "base64")).png().toBuffer();
      photoSrc = `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      photoSrc = null;
    }
  }

  const template: TemplateId = post.template === "B" || post.template === "C" ? post.template : "A";

  return new ImageResponse(
    renderEstado(template, {
      productName: post.productName,
      salePrice: post.salePrice,
      finalPrice: post.finalPrice,
      discountPct: post.discountPct,
      copy: post.copy,
      photoSrc,
      logoSrc: LOGO_SRC,
    }),
    {
      width: 1080,
      height: 1920,
      // El cliente pide siempre `?v={updatedAt}`, así que la URL identifica una
      // versión concreta del estado y su render nunca cambia: editar descuento,
      // plantilla o producto mueve el `v` y genera una URL nueva. Sin esto cada
      // recarga rehacía el viaje a Odoo + sharp + Satori desde cero.
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    }
  );
}
