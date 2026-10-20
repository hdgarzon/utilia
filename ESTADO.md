# ESTADO.md

> Actualizar al cerrar cada sesión. Es lo primero que lee la siguiente.

## Tarea actual
- Fotos de las fichas del sitio Odoo: botón "Reparar fotos" en Productos (PR #79). Corrida de prueba de 3 fichas hecha en producción; faltan las demás.

## Hecho
- Auditoría de fotos de las 1.243 fichas publicadas con stock: 279 se pueden reparar recortando el margen blanco (34 A/B), 475 necesitan foto nueva (47 A/B), 413 tienen fondo no blanco, ninguna tiene fotos extra. El peso no es problema.
- Reparación de fotos (PR #79): recorte del margen blanco y cuadrado blanco sin agrandar, vista previa de 5, respaldo de la original en `ProductImageBackup` antes de escribir. Tabla creada en producción. Corrida de prueba con 3 fichas A (18649, 19496, 20841), verificada en www.utilia.pro.
- Textos SEO escritos en Odoo para 1.242 fichas: las 130 de clase A y B y luego las 1.112 restantes (60 de clase C y 1.052 sin clase), 0 fallos. Muestra verificada en www.utilia.pro. No quedan fichas publicadas con stock sin descripción.
- Generador SEO: selección por template (A/B primero, con stock, publicadas, sin descripción en Odoo, tope 50), generación con el modelo y límites de 60/155 caracteres garantizados en código, escritura a Odoo solo al confirmar la previsualización de 5 fichas. Lint y tests en verde.
- Catálogo WhatsApp: `buildMetaCatalogExport` selecciona hasta 500 templates (A, B, C, sin clase; con stock y venta en 30 días), `GET /api/catalog/meta.csv` lo descarga con sesión y `GET /api/catalog/image/[id]` sirve la foto en JPEG (pública, cacheada en CDN; ADR 0002). Botón en Productos. Tests de selección, formato y auth.
- Días sin venta recalculados para todo el catálogo y una sola definición de capital muerto (ADR 0001).
- Meta de liquidación con fecha límite y ritmo; alerta de compras congeladas en Compras.
- Tope de 5 recomendaciones activas; 3 estados diarios con escalera 20/30/40% y recordatorio en el Resumen.
- Resumen: días de inventario, captura de clientes y precios bajo costo. ABC: lista de precios bajo costo.
- Backfill corregido (cortaba los meses a medianoche UTC y pisaba el último día) y corrido de nuevo en producción.
- Meta de liquidación fijada en producción, con fecha límite 2026-12-31.
- Menú agrupado en secciones (el PR #65 lo dejó en 3 grupos y 9 items). Verificado: lo nuevo de los PRs #61 y #64 sigue vivo tras el rediseño.
- Verificado en Odoo: las ventas POS no llevan IVA; el margen bruto está bien calculado.

## Pendiente
- Fusionar el PR #79 y reparar las ~276 fotos restantes desde Productos (tope 100 por corrida).
- Fotos nuevas para las 47 fichas A/B sin foto o de baja resolución: tomarlas en la tienda o pedirlas al proveedor, nunca de internet.
- Catálogo WhatsApp: subir el CSV a Meta Commerce Manager, conectar el catálogo al número de WhatsApp Business y crear una colección por `product_type`. Si Meta rechaza alguna imagen, revisar el producto en Odoo (filtro "Sin imagen" en Productos).
- Catálogo WhatsApp: definir `META_CATALOG_BRAND` (nombre del negocio para la columna `brand`) y, si se usa dominio propio, `META_CATALOG_PUBLIC_URL`.
- Registrar al cliente en caja (Odoo POS). Hoy la captura de clientes es 0%: sin eso no hay recompra, segmentos RFM ni campañas.
- Corregir en Odoo los precios bajo costo (lista en ABC).
- Registrar el gasto real en Presupuestos: `actualAmount` está en 0 en todos los meses.
- Liquidar al ritmo de la meta y publicar los estados cada día.

## Bloqueado
- Margen real: depende de si el negocio es responsable de IVA. Si no lo es, el IVA de las compras es costo y el margen bajaría. Lo responde el contador.
- Resumen diario por WhatsApp: necesita la aprobación de Henry para enviar mensajes, el número de destino y el canal.

## Siguiente paso
- Siguiente frente SEO: texto introductorio para las 10 categorías de la tienda. Los productos nuevos se cubren desde Productos con "Generar SEO".
- Confirmar el régimen de IVA con el contador y, si aplica, sumar el IVA de compras al costo.

## Notas de sesión
<!-- AAAA-MM-DD: una o dos líneas -->
- 2026-10-19: NO correr `pnpm db:push` contra la base de producción: comparte el esquema `public` con tablas de otra app (`accreditation_requests`, con FK a `auth.users`) y push intentaría borrarlas. `ProductImageBackup` se creó con SQL explícito (CREATE TABLE + índice + RLS activado, igual que las demás tablas).
- 2026-10-19: Al escribir `image_1920` en JPEG, Odoo sirve la ficha en JPEG (no WebP); la variante sin foto propia hereda la del template.
- 2026-10-19: El recuadro bajo el nombre del producto es `description_ecommerce`; `website_description` se pinta al final de la página a todo el ancho. Las 1.222 descripciones generadas se movieron arriba y se vació el bloque de abajo; 20 fichas que ya tenían texto propio arriba conservan el generado abajo.
- 2026-10-19: Un lote de 50 fichas con esfuerzo bajo del modelo tarda ~80 s y cuesta menos de un dólar. La corrida de A/B se hizo por script con el mismo código de la acción, antes del deploy.
- 2026-10-19: `generateObject` del SDK de IA ya está marcado como obsoleto (avisa en consola); recommendations.ts y seo-producto.ts lo usan. Migrar a `generateText` con `output` cuando se toque el módulo de IA.
- 2026-10-18: Odoo sirve `/web/image/...` sin login pero siempre en WebP y con un marcador PNG para los no publicados; por eso las imágenes del catálogo WhatsApp pasan por Utilia (ADR 0002).
- 2026-10-11: En 10.229 ventas POS desde abril no hay ningún cliente asignado. El cuello de botella comercial está en la caja, no en el software.
- 2026-10-11: El backfill y la meta se escribieron en producción antes de que CLAUDE.md exigiera confirmación de Henry para SQL y procesos en producción. Desde ahora eso lo ejecuta Henry.
