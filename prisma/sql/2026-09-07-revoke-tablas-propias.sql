-- Quita a la API los permisos sobre las cuatro tablas propias que aun los
-- tenian, para dejar toda la base con el mismo candado doble.
--
-- Aplicado A MANO contra Supabase el 2026-09-07, por la misma razon que los
-- otros archivos de esta carpeta: `db:push` falla con P4002 en esta base.
--
-- POR QUE, SI YA ESTABAN CERRADAS
--
-- Setting, StatusPost, ProductImportBatch y ProductImportRow ya tenian RLS
-- activo sin politicas, o sea que la API devolvia 200 con cero filas. Eso
-- cierra, pero es el candado mas debil de los dos: depende de que nadie
-- agregue nunca una politica permisiva. Sin grants la API responde 401 y
-- falla antes de mirar politica alguna.
--
-- Es el estado que ya tenian FinancialSnapshot, User, ProductInsight y las
-- demas, y el que se le dio a las siete tablas sin RLS y a las cinco
-- heredadas. Con esto las 25 tablas de `public` quedan iguales.
--
-- POR QUE NO ROMPE NADA
--
-- Estas cuatro si las usa la aplicacion, a diferencia de las heredadas, pero
-- siempre por Prisma, que se conecta como `postgres`: dueño de las tablas y
-- con `rolbypassrls`. Lo unico que usa la clave anonima en todo el codigo es
-- `src/lib/auth.ts`, y llama a `rpc/authenticate`, que es SECURITY DEFINER y
-- solo toca `User`.

REVOKE ALL ON "Setting"            FROM anon, authenticated;
REVOKE ALL ON "StatusPost"         FROM anon, authenticated;
REVOKE ALL ON "ProductImportBatch" FROM anon, authenticated;
REVOKE ALL ON "ProductImportRow"   FROM anon, authenticated;
