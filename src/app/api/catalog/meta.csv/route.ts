import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildMetaCatalogExport } from "@/lib/products/meta-catalog-export";
import { colombiaDayString } from "@/lib/timezone";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/catalog/meta.csv
 *
 * Descarga el catalogo WhatsApp: el CSV que se sube a Meta Commerce Manager.
 * Requiere sesion, como el resto del dashboard. Solo lee: ProductInsight, el
 * ABC y las variables de entorno. Las imagenes las sirve
 * /api/catalog/image/[id], que si es publica porque Meta la descarga.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const odooBaseUrl = process.env.ODOO_BASE_URL?.replace(/\/+$/, "");
  if (!odooBaseUrl) {
    return NextResponse.json({ error: "ODOO_BASE_URL no configurada" }, { status: 500 });
  }
  // La URL publica de Utilia es la misma desde la que se descarga el CSV,
  // salvo que se fije explicitamente (por ejemplo, un dominio propio).
  const publicBaseUrl = (process.env.META_CATALOG_PUBLIC_URL ?? req.nextUrl.origin).replace(/\/+$/, "");

  try {
    const result = await buildMetaCatalogExport({
      publicBaseUrl,
      odooBaseUrl,
      brand: process.env.META_CATALOG_BRAND,
    });
    return new NextResponse(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="catalogo-whatsapp-${colombiaDayString(new Date())}.csv"`,
        "Cache-Control": "no-store",
        "X-Catalog-Rows": String(result.rows),
        "X-Catalog-By-Tier": JSON.stringify(result.byTier),
      },
    });
  } catch (err) {
    console.error("[catalog] fallo la exportacion del catalogo WhatsApp:", err);
    return NextResponse.json(
      { error: "Export failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
