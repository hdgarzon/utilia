/**
 * Utilidades puras para armar el mensaje de pedido por WhatsApp (enlace wa.me).
 * Sin llamadas de red: el envío lo hace el usuario desde su propio WhatsApp.
 */

/** Normaliza a formato wa.me (solo dígitos, con indicativo). Colombia por defecto. */
export function normalizePhoneForWhatsApp(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  // CO: celular (empieza en 3) y fijo con indicativo de area nuevo (empieza
  // en 60, ej. "601" para Bogota) comparten el mismo largo de 10 digitos sin
  // el 57. Se valida el prefijo real para no confundir con un numero
  // extranjero de 10 digitos pegado por error (ej. uno de EE.UU.).
  if (digits.length === 10 && (digits.startsWith("3") || digits.startsWith("60"))) return `57${digits}`;
  if (digits.length === 12 && digits.startsWith("57")) return digits; // ya trae indicativo
  if (digits.length >= 11 && digits.length <= 15) return digits; // otro país, se respeta
  return null;
}

export function buildOrderMessage(
  supplierName: string,
  lines: Array<{ qty: number; name: string }>
): string {
  const items = lines.map((l) => `• ${l.qty} × ${l.name}`).join("\n");
  return (
    `Hola ${supplierName}, ¿cómo estás? Te paso el pedido:\n\n` +
    `${items}\n\n` +
    `¿Me confirmas disponibilidad y fecha de entrega? ¡Gracias!`
  );
}

export function buildWaLink(phone: string, message: string): string | null {
  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
