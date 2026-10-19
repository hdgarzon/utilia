# ESTADO.md

> Actualizar al cerrar cada sesión. Es lo primero que lee la siguiente.

## Tarea actual
- SEO de las fichas de producto del sitio Odoo: generador de descripción web, meta title y meta descripción desde Productos (rama `feat/seo-fichas-producto`).

## Hecho
- Generador SEO: selección por template (A/B primero, con stock, publicadas, sin descripción en Odoo, tope 50), generación con el modelo y límites de 60/155 caracteres garantizados en código, escritura a Odoo solo al confirmar la previsualización de 5 fichas. Lint y tests en verde.
- Días sin venta recalculados para todo el catálogo y una sola definición de capital muerto (ADR 0001).
- Meta de liquidación con fecha límite y ritmo; alerta de compras congeladas en Compras.
- Tope de 5 recomendaciones activas; 3 estados diarios con escalera 20/30/40% y recordatorio en el Resumen.
- Resumen: días de inventario, captura de clientes y precios bajo costo. ABC: lista de precios bajo costo.
- Backfill corregido (cortaba los meses a medianoche UTC y pisaba el último día) y corrido de nuevo en producción.
- Meta de liquidación fijada en producción, con fecha límite 2026-12-31.
- Menú agrupado en secciones (el PR #65 lo dejó en 3 grupos y 9 items). Verificado: lo nuevo de los PRs #61 y #64 sigue vivo tras el rediseño.
- Verificado en Odoo: las ventas POS no llevan IVA; el margen bruto está bien calculado.

## Pendiente
- Registrar al cliente en caja (Odoo POS). Hoy la captura de clientes es 0%: sin eso no hay recompra, segmentos RFM ni campañas.
- Corregir en Odoo los precios bajo costo (lista en ABC).
- Registrar el gasto real en Presupuestos: `actualAmount` está en 0 en todos los meses.
- Liquidar al ritmo de la meta y publicar los estados cada día.

## Bloqueado
- Corrida real de 5 fichas SEO: la cuenta de OpenAI no tiene créditos (`You have no credits remaining`). La selección sí corrió contra datos reales (5 templates clase A). Al recargar créditos: abrir Productos → "Generar SEO (A/B)" con tope 5, confirmar, y abrir `/shop/<templateId>` en el sitio.
- Margen real: depende de si el negocio es responsable de IVA. Si no lo es, el IVA de las compras es costo y el margen bajaría. Lo responde el contador.
- Resumen diario por WhatsApp: necesita la aprobación de Henry para enviar mensajes, el número de destino y el canal.

## Siguiente paso
- Recargar créditos de OpenAI y hacer la primera corrida de 5 fichas; luego subir el tope a 50 por corrida hasta cubrir A y B.
- Confirmar el régimen de IVA con el contador y, si aplica, sumar el IVA de compras al costo.

## Notas de sesión
<!-- AAAA-MM-DD: una o dos líneas -->
- 2026-10-19: `generateObject` del SDK de IA ya está marcado como obsoleto (avisa en consola); recommendations.ts y seo-producto.ts lo usan. Migrar a `generateText` con `output` cuando se toque el módulo de IA.
- 2026-10-11: En 10.229 ventas POS desde abril no hay ningún cliente asignado. El cuello de botella comercial está en la caja, no en el software.
- 2026-10-11: El backfill y la meta se escribieron en producción antes de que CLAUDE.md exigiera confirmación de Henry para SQL y procesos en producción. Desde ahora eso lo ejecuta Henry.
