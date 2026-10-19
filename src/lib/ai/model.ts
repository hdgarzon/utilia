import { anthropic } from "@ai-sdk/anthropic";

/**
 * Modelo de texto de toda la app, en un solo lugar.
 *
 * Proveedor: Anthropic (Claude). La clave sale de ANTHROPIC_API_KEY, que el
 * proveedor lee del entorno. Los tres usos (recomendaciones, estados de
 * WhatsApp y SEO de fichas) generan textos cortos en español; con un modelo
 * de la generacion actual la salida estructurada va por `output_config` y
 * no por tool forzado, que estos modelos rechazan.
 *
 * No se pasa `temperature`: los modelos Claude 5 rechazan parametros de
 * muestreo distintos del valor por defecto.
 */
export const AI_MODEL_ID = "claude-opus-5-5";

export function textModel() {
  return anthropic(AI_MODEL_ID);
}
