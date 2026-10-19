/**
 * Textos SEO para las fichas de producto del sitio Odoo (website_sale).
 *
 * Por cada template genera tres campos que Odoo ya sabe mostrar:
 *  - `website_description`: HTML corto (60-120 palabras) con uso, para quien
 *    es y la disponibilidad en la papeleria de Sabaneta o con envio.
 *  - `website_meta_title`: "Nombre En Capitalizacion Normal | Utilia Sabaneta",
 *    maximo 60 caracteres.
 *  - `website_meta_description`: maximo 155 caracteres, con llamado a la accion.
 *
 * El modelo solo recibe lo que hay en ProductInsight (nombre, categoria,
 * precio, variantes) y tiene prohibido inventar especificaciones. Los limites
 * de longitud se garantizan aqui, en codigo, no por confianza en el modelo:
 * Google corta lo que sobra y un titulo cortado se ve peor que uno corto.
 *
 * Este modulo no escribe en Odoo. Eso lo hace `writeSeoFields` en
 * src/lib/products/odoo-catalog-write.ts, solo por accion del usuario.
 */

import { textModel } from "@/lib/ai/model";
import { generateObject } from "ai";
import { z } from "zod";

export const META_TITLE_MAX = 60;
export const META_DESCRIPTION_MAX = 155;
export const DESCRIPTION_WORDS_MIN = 60;
export const DESCRIPTION_WORDS_MAX = 120;

const MARCA = "Utilia Sabaneta";
const SUFIJO_LARGO = ` | ${MARCA}`;
const SUFIJO_CORTO = " | Utilia";

export interface SeoProductInput {
  templateId: number;
  /** Nombre del template tal como viene de Odoo (normalmente en mayusculas). */
  name: string;
  category: string | null;
  salePrice: number;
  /** Nombres de las variantes, vacio si el producto no tiene. */
  variantNames: string[];
}

export interface SeoFields {
  websiteDescription: string;
  metaTitle: string;
  metaDescription: string;
}

export interface SeoGenerated extends SeoFields {
  templateId: number;
  name: string;
}

const seoSchema = z.object({
  tituloCorto: z
    .string()
    .describe(
      "Nombre del producto en capitalizacion normal (no mayusculas sostenidas), maximo 42 caracteres, con las palabras clave que alguien buscaria."
    ),
  descripcionHtml: z
    .string()
    .describe(
      "Descripcion en HTML simple (solo <p>, <ul>, <li>, <strong>). Entre 60 y 120 palabras. Menciona para que sirve, para quien es y que esta disponible en nuestra papeleria en Sabaneta o con envio."
    ),
  metaDescripcion: z
    .string()
    .describe("Meta descripcion de maximo 140 caracteres, termina con un llamado a la accion (comprar, pedir, visitar)."),
});

const SYSTEM_PROMPT = `Eres el redactor SEO de Utilia, una papeleria y piñateria de Sabaneta, Antioquia (Colombia), con tienda fisica y ventas con envio.

Escribes fichas de producto para la tienda en linea, en español de Colombia, claras y utiles para quien busca en Google o le pregunta a una IA.

Reglas estrictas:
- Usa SOLO los datos provistos (nombre, categoria, precio, variantes). No inventes medidas, materiales, marcas, cantidades ni colores que no aparezcan en el nombre o las variantes.
- Si el nombre dice poco, escribe sobre el uso tipico de ese tipo de producto en su categoria, sin atribuirle caracteristicas concretas.
- Tono cercano y profesional, tutea. Sin signos de exclamacion repetidos ni mayusculas sostenidas.
- La descripcion dice para que sirve, para quien es (estudiantes, oficinas, fiestas, etc.) y cierra con la frase "Disponible en nuestra papeleria en Sabaneta o con envio".
- No pongas el precio en los textos: cambia y Odoo ya lo muestra.
- No uses el nombre "Utilia" dentro de tituloCorto; el sitio lo agrega.`;

export function buildSeoPrompt(input: SeoProductInput): string {
  const lineas = [
    `Nombre: ${input.name}`,
    `Categoria: ${input.category ?? "sin categoria"}`,
    `Precio de lista: ${Math.round(input.salePrice).toLocaleString("es-CO")} COP`,
  ];
  if (input.variantNames.length > 0) {
    lineas.push(`Variantes: ${input.variantNames.join("; ")}`);
  }
  return `${lineas.join("\n")}\n\nGenera el titulo corto, la descripcion HTML y la meta descripcion.`;
}

/** Palabras que en español van en minuscula dentro de un titulo. */
const CONECTORES = new Set(["de", "del", "la", "el", "los", "las", "y", "e", "o", "u", "en", "con", "para", "por", "a", "al", "x"]);
/** Unidades que se escriben en minuscula aunque el nombre venga en mayusculas. */
const UNIDADES = new Set(["ml", "cm", "mm", "gr", "g", "kg", "lt", "l", "mts", "m", "und", "unds", "pcs", "hojas"]);

/**
 * "CUADERNO ARGOLLADO 100 HOJAS" -> "Cuaderno Argollado 100 Hojas".
 * Es el fallback cuando el modelo no da un titulo usable; tambien sirve
 * para mostrar nombres en pantalla.
 */
export function toTitleCase(name: string): string {
  const palabras = name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es").split(" ");
  return palabras
    .map((w, i) => {
      if (i > 0 && CONECTORES.has(w)) return w;
      if (UNIDADES.has(w) && i > 0 && /\d/.test(palabras[i - 1])) return w;
      // Respeta un prefijo no alfabetico ("(rojo" -> "(Rojo").
      const m = w.match(/^([^\p{L}]*)(\p{L})(.*)$/u);
      if (!m) return w;
      return `${m[1]}${m[2].toLocaleUpperCase("es")}${m[3]}`;
    })
    .join(" ");
}

/** Corta en limite de palabra, sin pasarse de `max`. */
function cortarEnPalabra(texto: string, max: number): string {
  const limpio = texto.trim().replace(/\s+/g, " ");
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max + 1);
  const ultimoEspacio = corte.lastIndexOf(" ");
  const base = ultimoEspacio > max * 0.5 ? corte.slice(0, ultimoEspacio) : limpio.slice(0, max);
  return base.replace(/[\s,;:(\-]+$/, "");
}

/**
 * Arma el meta title: "<nombre> | Utilia Sabaneta". Si no cabe en 60, prueba
 * con "| Utilia" y, si aun asi no cabe, recorta el nombre en una palabra.
 */
export function fitMetaTitle(nombre: string): string {
  const base = cortarEnPalabra(nombre, META_TITLE_MAX);
  if (base.length + SUFIJO_LARGO.length <= META_TITLE_MAX) return `${base}${SUFIJO_LARGO}`;
  if (base.length + SUFIJO_CORTO.length <= META_TITLE_MAX) return `${base}${SUFIJO_CORTO}`;
  const recortado = cortarEnPalabra(base, META_TITLE_MAX - SUFIJO_CORTO.length);
  return `${recortado}${SUFIJO_CORTO}`;
}

/** Garantiza el tope de 155 caracteres sin dejar una palabra partida. */
export function fitMetaDescription(texto: string): string {
  const limpio = texto.trim().replace(/\s+/g, " ");
  if (limpio.length <= META_DESCRIPTION_MAX) return limpio;
  const corte = cortarEnPalabra(limpio, META_DESCRIPTION_MAX - 1);
  return `${corte.replace(/[.!?…]+$/, "")}.`;
}

const TAGS_PERMITIDAS = new Set(["p", "ul", "ol", "li", "strong", "em", "br"]);

/**
 * Deja solo HTML inofensivo: etiquetas de la lista blanca y sin atributos.
 * El texto va al <head> y al cuerpo de una pagina publica; un `onclick` o un
 * <script> que se colara del modelo seria un agujero, no un detalle.
 */
export function sanitizeDescriptionHtml(html: string): string {
  let out = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_m, tag: string, offset: number, str: string) => {
    const t = tag.toLowerCase();
    if (!TAGS_PERMITIDAS.has(t)) return "";
    const cierre = str[offset + 1] === "/";
    if (t === "br") return "<br>";
    return cierre ? `</${t}>` : `<${t}>`;
  });
  out = out.trim();
  if (!out) return "";
  if (!/^<(p|ul|ol)>/i.test(out)) out = `<p>${out}</p>`;
  return out;
}

export function countWords(html: string): number {
  const texto = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
  return texto ? texto.split(/\s+/).length : 0;
}

/** Aplica los limites y la limpieza a lo que devolvio el modelo. */
export function normalizeSeoFields(input: SeoProductInput, raw: z.infer<typeof seoSchema>): SeoFields {
  const titulo = raw.tituloCorto.trim() || toTitleCase(input.name);
  const metaTitle = fitMetaTitle(titulo);
  const metaDescription = fitMetaDescription(raw.metaDescripcion);
  const websiteDescription = sanitizeDescriptionHtml(raw.descripcionHtml);
  return { websiteDescription, metaTitle, metaDescription };
}

export async function generateSeoFields(input: SeoProductInput): Promise<SeoGenerated> {
  const { object } = await generateObject({
    model: textModel(),
    schema: seoSchema,
    instructions: SYSTEM_PROMPT,
    prompt: buildSeoPrompt(input),
  });
  const fields = normalizeSeoFields(input, object);
  if (!fields.websiteDescription) {
    throw new Error(`El modelo devolvio una descripcion vacia para ${input.name}`);
  }
  return { templateId: input.templateId, name: input.name, ...fields };
}

/**
 * Genera en paralelo acotado. Odoo no interviene aqui; el limite es por
 * cortesia con la API del modelo y para que un lote de 50 termine en el
 * presupuesto de la funcion serverless.
 */
export async function generateSeoBatch(
  inputs: SeoProductInput[],
  concurrency = 4
): Promise<{ generated: SeoGenerated[]; failed: Array<{ templateId: number; name: string; error: string }> }> {
  const generated: SeoGenerated[] = [];
  const failed: Array<{ templateId: number; name: string; error: string }> = [];
  let cursor = 0;
  async function worker() {
    while (cursor < inputs.length) {
      const item = inputs[cursor++];
      try {
        generated.push(await generateSeoFields(item));
      } catch (err) {
        failed.push({ templateId: item.templateId, name: item.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, worker));
  // El orden de entrada es el orden de prioridad; se conserva.
  const pos = new Map(inputs.map((i, idx) => [i.templateId, idx]));
  generated.sort((a, b) => (pos.get(a.templateId) ?? 0) - (pos.get(b.templateId) ?? 0));
  return { generated, failed };
}
