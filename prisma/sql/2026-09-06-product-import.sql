-- Carga masiva de productos (Fase 2 del modulo de productos).
--
-- Aplicado A MANO contra Supabase el 2026-09-06, no con `prisma db:push`.
--
-- Por que a mano: la base de Utilia arrastra cinco tablas vacias de otra
-- aplicacion (profiles, accreditation_requests, competitions,
-- competition_entries, email_logs) cuyas llaves foraneas apuntan al esquema
-- `auth` de Supabase. Prisma no puede introspeccionarlo sin el preview
-- feature `multiSchema`, asi que `db:push` falla con P4002 ANTES de calcular
-- ningun diff -- para cualquier cambio, no solo para este. El dueño decidio
-- no tocar esas tablas.
--
-- Este archivo queda como registro auditable: es lo que realmente corrio, y
-- se puede diffear contra prisma/schema.prisma. Verificado despues de
-- aplicarlo contra information_schema, pg_indexes, pg_constraint y pg_enum:
-- las 27 columnas, ambos indices, la unicidad [batchId, rowIndex], el
-- ON DELETE CASCADE y los dos enums coinciden con lo que Prisma espera.

CREATE TYPE "ProductImportStatus" AS ENUM ('DRAFT', 'CREATING', 'DONE', 'PARTIAL');
CREATE TYPE "ProductImportRowStatus" AS ENUM ('PENDING', 'OK', 'ERROR');

CREATE TABLE "ProductImportBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProductImportStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductImportBatch_status_idx" ON "ProductImportBatch"("status");

CREATE TABLE "ProductImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "productType" TEXT NOT NULL DEFAULT 'consu',
    "isStorable" BOOLEAN NOT NULL DEFAULT true,
    -- Capturada para exportarla como pendiente. NUNCA se escribe en Odoo:
    -- ponerle cantidad a un producto exige un ajuste de inventario.
    "qtyOnHand" DOUBLE PRECISION,
    "salePrice" DOUBLE PRECISION,
    "cost" DOUBLE PRECISION,
    "purchaseTaxIds" INTEGER[],
    "categoryId" INTEGER,
    "imageUrl" TEXT,
    "imageData" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publicCategoryIds" INTEGER[],
    "showAvailability" BOOLEAN NOT NULL DEFAULT false,
    "supplierPartnerId" INTEGER,
    "status" "ProductImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "odooTemplateId" INTEGER,
    "error" TEXT,
    "warning" TEXT,
    CONSTRAINT "ProductImportRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductImportRow_batchId_idx" ON "ProductImportRow"("batchId");
CREATE UNIQUE INDEX "ProductImportRow_batchId_rowIndex_key" ON "ProductImportRow"("batchId", "rowIndex");

ALTER TABLE "ProductImportRow"
  ADD CONSTRAINT "ProductImportRow_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ProductImportBatch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS activado sin politicas: el rol dueño con el que se conecta Prisma la
-- salta, y queda cerrado el acceso con la clave anonima, que esta app nunca
-- usa para estos datos.
ALTER TABLE "ProductImportBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductImportRow" ENABLE ROW LEVEL SECURITY;
