# 0002 — Imágenes del catálogo WhatsApp servidas por Utilia

- **Fecha:** 2026-10-18
- **Estado:** aceptada

## Contexto
El catálogo WhatsApp se carga en Meta Commerce Manager con un CSV cuyo `image_link` debe ser una URL pública. Meta exige JPEG o PNG, mínimo 500×500 px, hasta 8 MB. Odoo guarda la foto en `image_1920` y la entrega en base64 por RPC o por la URL `/web/image/product.template/<id>/image_1920`.

Se probó la URL pública de Odoo contra la instancia real:
- Responde 200 sin login, pero **siempre en WebP**, sin importar la extensión o parámetro que se pida.
- Para los templates **no publicados** en la tienda web (y para ids inexistentes) devuelve un marcador de posición PNG, también con 200.

## Opciones consideradas
1. **URL pública de Odoo** en `image_link`. Cero código, pero WebP no está en los formatos que Meta documenta y los productos sin publicar saldrían con el marcador de Odoo.
2. **Ruta pública de Utilia** `GET /api/catalog/image/[id]` que lee la imagen de Odoo, la convierte a JPEG con `sharp` (ya era dependencia) y la cachea en el CDN de Vercel.
3. Subir las fotos a un almacenamiento aparte (Blob/S3) en cada sync. Resuelve el formato pero agrega un almacén que mantener y escribe fuera de Odoo.

## Decisión
Opción 2. La ruta intenta primero la URL pública de Odoo (barata, sin autenticar, no consume el cupo de llamadas RPC); si recibe el marcador de posición, lee `image_1920` por RPC, que sí trae la foto de los no publicados. Convierte a JPEG con fondo blanco, lado máximo 1280 px, y responde con `s-maxage` de un día para que las descargas de Meta no caigan todas sobre Odoo.

La ruta es pública a propósito: Meta descarga las imágenes sin sesión. Solo expone la foto del producto, que ya es pública en la tienda web de Odoo para los publicados. El CSV, que lleva precios y el catálogo completo, sí exige sesión.

## Consecuencias
- Las imágenes abren desde cualquier cliente en JPEG; Meta las acepta.
- Si cambia la foto en Odoo, Meta no la refresca hasta que cambie la URL: habría que agregar una versión al enlace.
- Un pico de descargas de Meta en frío puede toparse con el límite de concurrencia de Odoo.sh; la respuesta es 502 sin cache y Meta reintenta. Después del primer día las imágenes quedan en el CDN.
- El `link` del producto apunta a la tienda web de Odoo (`/shop/<id>`), que redirige al producto publicado y responde 404 para los no publicados. Si el negocio no usa la tienda web, ese enlace es solo informativo.
