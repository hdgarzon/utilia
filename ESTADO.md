# ESTADO.md

> Actualizar al cerrar cada sesión. Es lo primero que lee la siguiente.

## Tarea actual
- Plan de remate octubre–enero: precio de remate por tramo de antigüedad en Liquidación y exportación de etiquetas (rama `feat/precio-remate-por-tramo`).

## Hecho
- Liquidación: tramo de antigüedad, precio de remate sugerido y margen por producto; filtros por tramo y categoría; totales del lote; botón "Exportar etiquetas (CSV)". Precios en 0 o bajo costo marcados como "revisar precio" y fuera del descuento automático.
- Días sin venta recalculados para todo el catálogo y una sola definición de capital muerto (ADR 0001).
- Meta de liquidación con fecha límite y ritmo; alerta de compras congeladas en Compras.
- Tope de 5 recomendaciones activas; 3 estados diarios con escalera 20/30/40% y recordatorio en el Resumen.
- Resumen: días de inventario, captura de clientes y precios bajo costo. ABC: lista de precios bajo costo.
- Backfill corregido (cortaba los meses a medianoche UTC y pisaba el último día) y corrido de nuevo en producción.
- Meta de liquidación fijada en producción, con fecha límite 2026-12-31.
- Menú agrupado en secciones (el PR #65 lo dejó en 3 grupos y 9 items). Verificado: lo nuevo de los PRs #61 y #64 sigue vivo tras el rediseño.
- Verificado en Odoo: las ventas POS no llevan IVA; el margen bruto está bien calculado.

## Pendiente
- Imprimir las etiquetas de remate desde el CSV y corregir en Odoo los productos marcados "revisar precio" antes de rematarlos.
- Registrar al cliente en caja (Odoo POS). Hoy la captura de clientes es 0%: sin eso no hay recompra, segmentos RFM ni campañas.
- Corregir en Odoo los precios bajo costo (lista en ABC).
- Registrar el gasto real en Presupuestos: `actualAmount` está en 0 en todos los meses.
- Liquidar al ritmo de la meta y publicar los estados cada día.

## Bloqueado
- Margen real: depende de si el negocio es responsable de IVA. Si no lo es, el IVA de las compras es costo y el margen bajaría. Lo responde el contador.
- Resumen diario por WhatsApp: necesita la aprobación de Henry para enviar mensajes, el número de destino y el canal.

## Siguiente paso
- Confirmar el régimen de IVA con el contador y, si aplica, sumar el IVA de compras al costo.

## Notas de sesión
<!-- AAAA-MM-DD: una o dos líneas -->
- 2026-10-19: El precio de remate es una sugerencia en pantalla y en el CSV; no se escribe en Odoo. El tramo de costo + 10% se topa en el precio normal para que el remate nunca salga más caro.
- 2026-10-11: En 10.229 ventas POS desde abril no hay ningún cliente asignado. El cuello de botella comercial está en la caja, no en el software.
- 2026-10-11: El backfill y la meta se escribieron en producción antes de que CLAUDE.md exigiera confirmación de Henry para SQL y procesos en producción. Desde ahora eso lo ejecuta Henry.
