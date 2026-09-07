-- Quita los permisos de la API a las cinco tablas heredadas.
--
-- Aplicado A MANO contra Supabase el 2026-09-07, por la misma razon que los
-- otros archivos de esta carpeta: `db:push` falla con P4002 en esta base --
-- de hecho, por culpa de estas mismas cinco tablas, cuyas llaves foraneas
-- apuntan al esquema `auth` de Supabase.
--
-- QUE SON
--
-- Restos de otra aplicacion que compartio esta base de datos. Utilia no las
-- lee ni las escribe: no estan en prisma/schema.prisma y nada en src/ las
-- nombra. Las cinco estan en cero filas. El dueño confirmo que esa
-- aplicacion esta muerta.
--
-- QUE ESTABA MAL
--
-- `email_logs` aceptaba INSERT anonimo. La politica se llama "Service role
-- can insert logs" pero esta concedida a `public`, no a `service_role`, con
-- WITH CHECK true, y `anon` tenia el grant de INSERT. Verificado con el motor
-- de RLS (SET ROLE anon dentro de una transaccion revertida): un INSERT sin
-- RETURNING pasa. Escritura ciega -- no se puede leer de vuelta -- pero sirve
-- para llenar la base o ensuciar el registro de correos.
--
-- Las lecturas ya fallaban, pero por un error y no por diseño: la politica de
-- admin de `profiles` hace EXISTS (SELECT 1 FROM profiles ...), o sea se
-- consulta a si misma, y Postgres corta con 42P17 (infinite recursion). Como
-- las otras cuatro repiten esa consulta en su politica de admin, la recursion
-- las alcanza a todas. Si alguien arreglara la recursion, las politicas
-- previstas volverian -- incluida "Anyone can read active competitions", que
-- es lectura abierta a anon sin ninguna comprobacion de identidad.
--
-- POR ESO SE QUITAN LOS GRANTS Y NO SE TOCA NADA MAS
--
-- Sin permiso no hay politica que evaluar: se corta el INSERT y se corta
-- cualquier politica permisiva que quede o que alguien reviva despues. Las
-- politicas, los datos y el esquema quedan intactos por si algun dia hay que
-- rescatar esa aplicacion; recuperar el acceso es volver a conceder.
--
-- No se toca la recursion de `profiles`: arreglarla seria revivir las
-- politicas de una aplicacion muerta, y con los grants quitados da igual.

REVOKE ALL ON "profiles"               FROM anon, authenticated;
REVOKE ALL ON "competitions"           FROM anon, authenticated;
REVOKE ALL ON "competition_entries"    FROM anon, authenticated;
REVOKE ALL ON "accreditation_requests" FROM anon, authenticated;
REVOKE ALL ON "email_logs"             FROM anon, authenticated;
