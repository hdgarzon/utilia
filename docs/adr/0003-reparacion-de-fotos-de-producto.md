# 0003 — Reparacion automatica de fotos de producto

- **Fecha:** 2026-10-19
- **Estado:** aceptada

## Contexto
Una auditoria de las 1.243 fichas publicadas con stock mostro que el peso de las fotos no es problema (Odoo ya las sirve en WebP, ~25 KB la mediana), pero que muchas tienen el producto pequeño en medio de un lienzo blanco o apaisado. Hay ademas 475 fichas sin foto o con menos de 500 px utiles, que ningun proceso automatico arregla.

## Opciones consideradas
1. Comprimir y convertir todas a WebP.
2. Reescalar las fotos pequeñas a 800 px o mas.
3. Recortar el margen blanco y centrar el producto en un cuadrado blanco, solo cuando el fondo es blanco, sin agrandar.
4. Bajar fotos de internet para las fichas sin foto.

## Decision
La 3. La 1 no cambia nada visible. La 2 inventa pixeles: la foto se ve borrosa y mas pesada. La 4 tiene derechos de autor; las fotos nuevas se toman en la tienda o se piden al proveedor. Las fotos con fondo de color o de ambiente no se tocan: recortarlas deja un recuadro de otro color pegado sobre blanco.

La foto original se respalda en Postgres (`ProductImageBackup`) antes de escribir en Odoo, y sin respaldo no se escribe. `image_1920` entra a la lista blanca de actualizacion de `write-guard.ts`.

## Consecuencias
- La regla es idempotente: una foto reparada queda cuadrada con el producto al 88 % y no vuelve a calificar.
- Una foto pequeña queda mejor encuadrada pero sigue pequeña; la vista previa lo marca.
- El respaldo ocupa espacio en Postgres (~25-100 KB por ficha). Se restaura con `scripts/restore-product-image.ts`.
- Si cambia el criterio de "fondo blanco" (borde >= 90 %) o de "producto chico" (< 80 % del lado), hay que volver a medir con `scripts/audit-product-images.ts`.
