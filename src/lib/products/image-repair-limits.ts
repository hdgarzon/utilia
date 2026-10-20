/**
 * Topes de la reparacion de fotos. Sin imports: los lee tanto el servidor
 * como el boton en el cliente.
 */

/** Tope por defecto de fichas por corrida. */
export const IMAGE_REPAIR_LIMIT = 30;
/**
 * Tope maximo que acepta la accion. Para juntar 100 hay que leer unas 450
 * fotos de Odoo (califica ~1 de cada 4-5), y eso tiene que caber en los 300 s
 * de la funcion junto con las escrituras.
 */
export const IMAGE_REPAIR_MAX = 100;
/** Fichas que se muestran antes y despues antes de confirmar. */
export const IMAGE_REPAIR_PREVIEW_COUNT = 5;
