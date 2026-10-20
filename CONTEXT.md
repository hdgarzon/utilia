# CONTEXT.md — Glosario del dominio

Términos del proyecto y su significado exacto. Úsalos en código, commits, docs y conversación. Si un término no está aquí, no lo inventes: pregunta y agrégalo.

## Términos

| Término | Significado | Dónde aparece |
|---|---|---|
| Capital muerto | Inventario a costo (stock × CMP) de productos con más de `DEAD_STOCK_DAYS` (30) días sin venta. Se cuenta por variante. | `dead-stock.ts`, Liquidación, Resumen, ABC |
| Días sin venta | Días desde la última venta (`rotationDays`). Si nunca se vio una venta, desde que el producto entró al sistema. | `ProductInsight.rotationDays`, `sync.ts` |
| Regla de no-recompra | Un producto con más de `NO_REORDER_DAYS` (45) días sin venta no se repone; si se compra, aparece como compra congelada. | `dead-stock.ts`, `replenishment.ts`, `stock-levels.ts` |
| Compra congelada | Compra a proveedor, de los últimos 30 días, de una referencia que la regla de no-recompra congela. | `purchases.ts`, Compras |
| Meta de liquidación | Monto de capital muerto a liberar antes de una fecha límite. El avance es la caída del capital muerto desde la línea base. | `dead-stock.ts`, Liquidación |
| Ritmo (de la meta) | Lo que hay que liberar por semana para llegar a la fecha, comparado con lo liberado por semana desde que se fijó la meta. | `computeGoalPace` |
| Días de inventario | Inventario a costo ÷ costo vendido por día calendario (ventana de 30 días). | `getInventoryHealth`, Resumen |
| Rotación anual | 365 ÷ días de inventario. Sano en papelería: 4–6 veces al año. | Resumen |
| Captura de clientes | Porcentaje de ventas POS con cliente asignado en caja, en los últimos 30 días. | `customers.ts`, Resumen |
| Precio bajo costo | Producto con stock cuyo precio de lista es igual o menor a su CMP. | `opportunities.ts`, ABC |
| CMP | Costo medio ponderado del producto (`standard_price` en Odoo). | `ProductInsight.cmp` |
| Estado (de WhatsApp) | Publicación diaria de un producto de capital muerto con descuento escalonado según los días sin venta (20, 30 o 40%). | `status-posts.ts`, Campañas |
| Fondo de reposición | Costo de lo vendido en los últimos 30 días: el dinero que ya le pertenece al inventario y se reinvierte. | `open-to-buy.ts` |
| OTB (Open-to-Buy) | Plan de compra por categoría: venta proyectada + stock final deseado − stock actual. | `open-to-buy.ts`, Compras |
| Snapshot financiero | Fila diaria de ingreso, costo y utilidad. El P&L mensual sale de `financial-month.ts`, no de sumar sus columnas de gasto fijo. | `FinancialSnapshot` |
| Ficha de producto | Página pública de un template en el sitio Odoo (`/shop/<slug>-<templateId>`). Una por template, no por variante. Lleva descripción corta (`description_ecommerce`, el recuadro junto al nombre), meta title y meta descripción. `website_description` es el bloque a todo el ancho al final de la página; el generador no lo usa. | `seo-producto.ts`, `seo-candidates.ts`, Productos |
| Meta descripción | Resumen de hasta 155 caracteres que Google muestra bajo el título del resultado (`website_meta_description` en Odoo). El meta title va en 60 caracteres con el formato "Nombre \| Utilia Sabaneta". | `seo-producto.ts`, `writeSeoFields` |
| Backfill | Reconstrucción del histórico de ventas desde Odoo, mes a mes, cortando los meses a medianoche de Colombia. | `backfillSalesHistory`, `pnpm backfill` |
| Catálogo WhatsApp | Exportación del catálogo al CSV de Meta Commerce Manager, que se conecta al número de WhatsApp Business. Un producto por template, hasta 500, con stock y venta en los últimos 30 días, priorizando clase A y B. | `meta-catalog-export.ts`, `/api/catalog/meta.csv`, Productos |
| Colección | Agrupación de productos dentro del catálogo WhatsApp. Una por categoría de Odoo, con el nombre en formato "Papeleria", "Piñateria" (columna `product_type` del CSV). | `toCollectionName`, Meta Commerce Manager |

## Fuera de alcance
- Cambiar precios en Odoo: el sistema señala los precios bajo costo, la corrección la hace Henry.
- Escribir en Odoo desde el sync. Los textos SEO se escriben solo al confirmar la previsualización en Productos.
- Enviar mensajes a clientes o proveedores sin aprobación explícita.

## Decisiones clave
- [0001 — Una sola definición de capital muerto](docs/adr/0001-definicion-unica-capital-muerto.md)
- [0002 — Imágenes del catálogo WhatsApp servidas por Utilia](docs/adr/0002-imagenes-catalogo-whatsapp.md)
