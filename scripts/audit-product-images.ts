/**
 * Auditoria de las fotos de las fichas publicadas con stock. SOLO LECTURA:
 * lee Postgres (ProductInsight, ABC) y Odoo (image_1920 y fotos extra por
 * RPC), mide cada imagen con sharp y escribe un reporte JSON local.
 *
 * Uso: tsx --env-file=<ruta>/.env.local scripts/audit-product-images.ts <salida.json>
 */
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { prisma } from "../src/lib/prisma";
import { odooRpc } from "../src/lib/odoo";
import { getABCAnalysis, type ABCTier } from "../src/lib/analytics/abc";
import { groupSeoInsights } from "../src/lib/products/seo-candidates";

const LOTE = 20;

async function medir(b64: string) {
  const buf = Buffer.from(b64, "base64");
  const img = sharp(buf);
  const meta = await img.metadata();
  // Borde: 48x48 aplanado sobre blanco; mira la franja exterior de 3 px.
  const { data, info } = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .resize(48, 48, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let borde = 0;
  let blancos = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (x > 2 && y > 2 && x < info.width - 3 && y < info.height - 3) continue;
      const i = (y * info.width + x) * info.channels;
      borde++;
      if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) blancos++;
    }
  }
  // Caja del producto: recorta el blanco alrededor (umbral 12).
  const rec = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .trim({ background: "#ffffff", threshold: 12 })
    .toBuffer({ resolveWithObject: true })
    .catch(() => null);
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const ladoProducto = rec ? Math.max(rec.info.width, rec.info.height) : Math.max(w, h);
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? "?",
    hasAlpha: !!meta.hasAlpha,
    bytes: buf.length,
    bordeBlanco: blancos / borde,
    // Lado mayor del producto sobre el lado mayor del lienzo: cuanto ocupa.
    ocupacion: ladoProducto / Math.max(w, h),
    ladoProducto,
  };
}

(async () => {
  const salida = process.argv[2];
  if (!salida) throw new Error("Falta la ruta de salida");

  const [insights, abc, publicadosRaw] = await Promise.all([
    prisma.productInsight.findMany({
      where: { odooTemplateId: { not: null }, stockQty: { gt: 0 } },
      select: {
        odooProductId: true, odooTemplateId: true, templateName: true, name: true,
        category: true, stockQty: true, salePrice: true, avgDailySales30d: true,
      },
    }),
    getABCAnalysis(),
    odooRpc.searchRead<{ id: number }>(
      "product.template",
      [["is_published", "=", true], ["sale_ok", "=", true]],
      ["id"],
      { limit: 10000 }
    ),
  ]);
  const tierOf = new Map<number, ABCTier>(abc.products.map((p) => [p.odooProductId, p.tier]));
  const publicados = new Set(publicadosRaw.map((t) => t.id));
  const fichas = groupSeoInsights(insights)
    .filter((p) => p.stockQty > 0 && publicados.has(p.templateId))
    .map((p) => ({ ...p, tier: tierOf.get(p.templateId) ?? null }));
  console.log("fichas publicadas con stock:", fichas.length);

  const filas: unknown[] = [];
  for (let i = 0; i < fichas.length; i += LOTE) {
    const lote = fichas.slice(i, i + LOTE);
    const rows = await odooRpc.searchRead<{
      id: number; image_1920: string | false; product_template_image_ids: number[];
    }>(
      "product.template",
      [["id", "in", lote.map((f) => f.templateId)]],
      ["id", "image_1920", "product_template_image_ids"],
      { limit: LOTE, timeoutMs: 120_000 }
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const f of lote) {
      const r = byId.get(f.templateId);
      const img = r && typeof r.image_1920 === "string" ? r.image_1920 : null;
      let medida = null;
      let error: string | null = null;
      if (img) {
        try { medida = await medir(img); } catch (e) { error = String(e); }
      }
      filas.push({
        templateId: f.templateId, name: f.name, category: f.category, tier: f.tier,
        avgDailySales30d: f.avgDailySales30d, stockQty: f.stockQty, salePrice: f.salePrice,
        extras: r?.product_template_image_ids.length ?? 0,
        imagen: medida, error,
      });
    }
    process.stdout.write(`\r${Math.min(i + LOTE, fichas.length)}/${fichas.length}`);
  }
  writeFileSync(salida, JSON.stringify(filas, null, 1));
  console.log("\nlisto:", salida);
  await prisma.$disconnect();
})();
