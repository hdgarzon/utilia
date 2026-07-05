/**
 * Categorías que NO son inventario físico reponible: servicios (fotocopias,
 * impresiones, recargas…) y los buckets por defecto de Odoo.
 *
 * Estas categorías distorsionan cualquier vista de inventario porque tienen
 * stock 0 estructural: aparecen eternamente como "crítico <N días" sin que se
 * pueda resolver nunca (no hay nada que reponer). Se excluyen de:
 *   - el plan de compras OTB (no se "compran" como stock),
 *   - las alertas de stock (Home, Inventario), para no entrenar al usuario a
 *     ignorar el semáforo (alarm fatigue).
 *
 * Comparación case-insensitive porque en Odoo aparecen en mayúsculas
 * ("SERVICIOS") pero conviene ser robustos.
 */
const SERVICE_CATEGORIES = new Set(["servicios", "all", "all / deliveries"]);

export function isServiceCategory(category: string | null): boolean {
  return category !== null && SERVICE_CATEGORIES.has(category.trim().toLowerCase());
}
