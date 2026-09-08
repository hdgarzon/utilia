-- Minimos y maximos (regla de reabastecimiento) en la hoja de carga masiva.
--
-- Aplicado A MANO contra Supabase el 2026-09-08, por la misma razon que los
-- otros archivos de esta carpeta: `db:push` falla con P4002 en esta base.
--
-- POR QUE ESTAS CIFRAS SI SE ESCRIBEN EN ODOO Y `qtyOnHand` NO
--
-- Una regla de reabastecimiento (`stock.warehouse.orderpoint`) dice "cuando
-- el stock baje de X, repon hasta Y". No mueve una sola unidad: crearla no
-- cambia `qty_available`. Poner cantidad a la mano, en cambio, exige un
-- ajuste de inventario, y eso sigue prohibido.
--
-- La regla se crea SIEMPRE con `trigger: manual`, asi que queda como
-- sugerencia en la pantalla de reabastecimiento y no dispara ninguna compra
-- sola. Es ademas lo que ya hace la tienda: de sus 1.548 reglas, 1.468 son
-- manuales, ninguna transitoria, todas con cifras de verdad.
--
-- Van juntas o ninguna: Odoo declara los dos campos obligatorios, asi que
-- media regla no se puede crear. La validacion de la hoja lo exige antes de
-- llegar a Odoo.

ALTER TABLE "ProductImportRow"
  ADD COLUMN IF NOT EXISTS "stockMin" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "stockMax" DOUBLE PRECISION;
