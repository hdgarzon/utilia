# 0001 — Una sola definición de capital muerto

- **Fecha:** 2026-10-11
- **Estado:** aceptada

## Contexto
El sistema tenía dos definiciones de capital muerto que no coincidían: el Resumen y el ABC contaban "sin venta en 7 días", y Liquidación contaba `rotationDays > 30`. Entre las dos había una diferencia de unas 7 veces. Además, `rotationDays` solo se escribía para los productos vendidos en los últimos 30 días, así que lo que nunca vendió quedaba en 0: Liquidación, la regla de no-recompra y los estados no veían el capital muerto más profundo.

## Opciones consideradas
1. Sin venta en 7 días (velocidad 7d = 0). Marca como muerto lo que vende un par de veces al mes.
2. Sin venta en 30 días, leído de `rotationDays` recalculado para todo el catálogo.
3. Sin venta en 90 días. Llega tarde: en papelería la temporada dura semanas.

## Decisión
Opción 2. `DEAD_STOCK_DAYS = 30` en `src/lib/analytics/dead-stock.ts`, leído de `ProductInsight.rotationDays`. El sync lo recalcula para todo el catálogo: desde `lastSoldAt`, o desde el alta del producto si nunca se vio una venta (es un piso, "al menos N días"). El backfill fija la última venta histórica. Los totales se cuentan por variante en todas las pantallas.

La regla de no-recompra queda aparte, en `NO_REORDER_DAYS = 45`: entre 30 y 45 días un producto ya cuenta como capital muerto, pero todavía se puede reponer.

## Consecuencias
- Resumen, ABC, Liquidación, Inventario, los estados y el detector de recomendaciones cuentan lo mismo.
- La cifra de capital muerto que muestra Liquidación subió mucho al corregirse: es la real, no un empeoramiento.
- Para los productos sin ninguna venta registrada, los días cuentan desde que entraron al sistema, no desde su compra real. Si Odoo expone la fecha de entrada al inventario, conviene usarla.
