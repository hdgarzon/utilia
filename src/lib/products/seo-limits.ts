/**
 * Topes del generador SEO. Sin imports: los lee tanto el servidor
 * (seo-candidates.ts, la accion) como el boton en el cliente.
 */

/** Tope por defecto de fichas por corrida. Controla el costo del modelo. */
export const SEO_BATCH_LIMIT = 50;
/** Tope maximo que acepta la accion, por tiempo de la funcion serverless. */
export const SEO_BATCH_MAX = 200;
/** Fichas que se muestran en la previsualizacion antes de confirmar. */
export const SEO_PREVIEW_COUNT = 5;
