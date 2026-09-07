-- Estado CREATING para una fila de carga masiva.
--
-- Aplicado A MANO contra Supabase el 2026-09-07, por la misma razon que el
-- archivo del 2026-09-06: `db:push` falla con P4002 antes de calcular ningun
-- diff por las tablas heredadas que apuntan al esquema `auth`.
--
-- Por que hace falta el estado: la fila se marca CREATING ANTES de llamar a
-- Odoo y solo pasa a OK cuando el id vuelve y se registra. Si el registro no
-- se puede guardar -- o el proceso muere en medio -- la fila se queda en
-- CREATING, que no lo mira ni la tanda de creacion (toma PENDING) ni el
-- reintento (toma ERROR). Sin este estado la fila quedaba en PENDING, no se
-- distinguia de una que nunca se intento, y un "Reintentar" corriente creaba
-- el producto por segunda vez en Odoo.
--
-- ADD VALUE es aditivo: no reescribe filas ni invalida las que ya existen.
-- En PostgreSQL 12+ corre fuera de transaccion sin bloquear la tabla.

ALTER TYPE "ProductImportRowStatus" ADD VALUE IF NOT EXISTS 'CREATING' BEFORE 'OK';
