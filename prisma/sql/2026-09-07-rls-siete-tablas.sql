-- Cierra las siete tablas que quedaron sin RLS.
--
-- Aplicado A MANO contra Supabase el 2026-09-07, por la misma razon que los
-- otros archivos de esta carpeta: `db:push` falla con P4002 en esta base.
--
-- QUE ESTABA PASANDO
--
-- Estas siete tenian `relrowsecurity = false`, cero politicas, y ademas los
-- roles `anon` y `authenticated` de Supabase con SELECT, INSERT, UPDATE,
-- DELETE y TRUNCATE encima, mas USAGE sobre el esquema `public`. Verificado
-- contra la API REST del proyecto con la clave anonima: las tres que se
-- probaron devolvieron HTTP 206 con filas. Son ~5.000 filas de datos
-- comerciales reales -- nombres de proveedores, precios de contrato en
-- PurchaseOrderLine, margenes por categoria en CategorySnapshot -- o sea
-- justo lo que CLAUDE.md prohibe exponer.
--
-- La clave anonima hoy no llega al navegador (`SUPABASE_ANON_KEY`, sin
-- prefijo NEXT_PUBLIC_, y no aparece en el bundle). Pero es una clave que
-- Supabase diseña para ser publica, y `NEXT_PUBLIC_SUPABASE_URL` si es
-- publica: el endpoint se conoce y lo unico que separa esas tablas de
-- internet es que la clave no se haya filtrado todavia. Eso no es un
-- control, es una racha de suerte.
--
-- POR QUE ESTO NO ROMPE LA APP
--
-- Prisma se conecta como `postgres`, que es dueño de las siete y ademas
-- tiene `rolbypassrls`. Ignora RLS por partida doble. Y no se usa FORCE,
-- justamente para no quitarle esa salida al dueño.
--
-- El login tampoco se toca: `src/lib/auth.ts` es lo unico que usa la clave
-- anonima, y llama a `rpc/authenticate`, que es SECURITY DEFINER y corre
-- como postgres. Por eso hoy puede leer `User` pese a que `anon` no tiene
-- ningun permiso sobre esa tabla.
--
-- Se hacen las dos cosas -- activar RLS y quitar los grants -- porque son
-- candados independientes. Con RLS solo, la API responde 200 con cero filas;
-- sin grants responde 401. Es el estado que ya tenian FinancialSnapshot y
-- User, y es mejor: falla mas temprano y no depende de que nadie agregue una
-- politica permisiva por descuido mas adelante.

ALTER TABLE "PurchaseOrder"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrderLine"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductSupplierOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReplenishmentOrder"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReplenishmentLine"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CategorySnapshot"        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "PurchaseOrder"           FROM anon, authenticated;
REVOKE ALL ON "PurchaseOrderLine"       FROM anon, authenticated;
REVOKE ALL ON "Supplier"                FROM anon, authenticated;
REVOKE ALL ON "ProductSupplierOverride" FROM anon, authenticated;
REVOKE ALL ON "ReplenishmentOrder"      FROM anon, authenticated;
REVOKE ALL ON "ReplenishmentLine"       FROM anon, authenticated;
REVOKE ALL ON "CategorySnapshot"        FROM anon, authenticated;
