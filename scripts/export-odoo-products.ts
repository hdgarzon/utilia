/**
 * Exporta todos los productos de Odoo como SENTENCIAS SQL INSERT
 * compatibles con la tabla ProductInsight. Salida: /tmp/odoo_products.sql
 *
 * Uso:
 *   set -a && source .env.local && set +a && npx tsx scripts/export-odoo-products.ts
 */

import { writeFileSync } from "node:fs";
import { odoo } from "../src/lib/odoo";
import { randomBytes } from "node:crypto";

function cuid(): string {
  // CUID-ish: timestamp + random hex (suficiente para batch insert)
  return "c" + Date.now().toString(36) + randomBytes(6).toString("hex");
}

function sqlEscape(value: string | null | undefined | false): string {
  if (value === null || value === undefined || value === false) return "NULL";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

async function main() {
  console.log("📦 Fetching products from Odoo…");
  const products = await odoo.getProducts();
  console.log(`✓ ${products.length} productos obtenidos`);

  const BATCH = 200;
  const files: string[] = [];

  for (let i = 0; i < products.length; i += BATCH) {
    const chunk = products.slice(i, i + BATCH);
    const values = chunk.map((p) => {
      const id = cuid();
      const ref = p.default_code === false ? null : p.default_code;
      const cat = p.categ_id?.[1] ?? null;
      return `(${sqlEscape(id)}, ${p.id}, ${sqlEscape(ref)}, ${sqlEscape(p.name)}, ${sqlEscape(cat)}, ${p.qty_available}, ${p.standard_price}, ${p.list_price}, NOW(), NOW())`;
    });

    const sql = `INSERT INTO "ProductInsight" (id, "odooProductId", "internalRef", name, category, "stockQty", cmp, "salePrice", "createdAt", "updatedAt")
VALUES
${values.join(",\n")}
ON CONFLICT ("odooProductId") DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  "stockQty" = EXCLUDED."stockQty",
  cmp = EXCLUDED.cmp,
  "salePrice" = EXCLUDED."salePrice",
  "updatedAt" = NOW();
`;

    const path = `/tmp/odoo_products_${String(i).padStart(5, "0")}.sql`;
    writeFileSync(path, sql);
    files.push(path);
  }

  console.log(`✓ ${files.length} archivos SQL generados:`);
  files.forEach((f) => console.log(`   ${f}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
