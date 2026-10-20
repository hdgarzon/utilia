import { NextRequest, NextResponse } from "next/server";
import { getCatalogImageJpeg, type CatalogImageKind } from "@/lib/products/catalog-image";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/catalog/image/[id]?kind=template|variant
 *
 * Imagen de un producto en JPEG para el catalogo WhatsApp. Es PUBLICA a
 * proposito: Meta descarga `image_link` sin sesion. Solo expone la imagen,
 * que ya es publica en la tienda web de Odoo para los productos publicados.
 * Se cachea en el CDN un dia para que las descargas de Meta no caigan todas
 * sobre Odoo.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }
  const kindParam = req.nextUrl.searchParams.get("kind");
  const kind: CatalogImageKind = kindParam === "variant" ? "variant" : "template";

  try {
    const jpeg = await getCatalogImageJpeg(kind, id);
    if (!jpeg) {
      return NextResponse.json({ error: "sin imagen" }, { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
    }
    return new NextResponse(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(jpeg.byteLength),
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (err) {
    console.error(`[catalog] fallo la imagen ${kind} ${id}:`, err);
    return NextResponse.json({ error: "image failed" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
