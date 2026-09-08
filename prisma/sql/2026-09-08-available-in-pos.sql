-- Punto de venta en la hoja de carga masiva.
--
-- Aplicado A MANO contra Supabase el 2026-09-08, por la misma razon que los
-- otros archivos de esta carpeta: `db:push` falla con P4002 en esta base.
--
-- `available_in_pos` decide si el producto sale en la caja del punto de
-- venta. Se pidio despues de cargar el primer producto de prueba y ver que
-- nacia por fuera de la caja, con lo cual habia que entrar a Odoo producto
-- por producto a marcarlo.
--
-- Es una bandera de catalogo: no crea stock ni movimiento, solo decide donde
-- se ve el producto. Por eso entra en CREATE_ONLY_FIELDS de la barrera y no
-- en las listas de actualizacion -- se fija al dar de alta y despues se
-- cambia en Odoo, como el resto de campos de creacion.
--
-- El default es false aunque la hoja nazca con la casilla marcada: si alguna
-- vez se inserta una fila sin el campo, que el producto NO entre a la caja
-- por accidente. La hoja siempre lo manda explicito.
--
-- ADD COLUMN con default constante no reescribe la tabla en PostgreSQL 11+.

ALTER TABLE "ProductImportRow"
  ADD COLUMN IF NOT EXISTS "availableInPos" BOOLEAN NOT NULL DEFAULT false;
