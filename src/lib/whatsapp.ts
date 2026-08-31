/**
 * Utilidades puras para armar el mensaje de pedido por WhatsApp (enlace wa.me).
 * Sin llamadas de red: el envío lo hace el usuario desde su propio WhatsApp.
 */

/** Normaliza a formato wa.me (solo dígitos, con indicativo). Colombia por defecto. */
export function normalizePhoneForWhatsApp(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return `57${digits}`; // celular CO sin indicativo
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
