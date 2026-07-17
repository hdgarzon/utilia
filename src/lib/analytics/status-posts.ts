/**
 * Selección diaria de "Estados de WhatsApp" para liquidar capital muerto.
 *
 * Cada día elige SLOTS productos de capital muerto (rotationDays > 30, stock > 0),
 * priorizando el mayor capital invertido (stockQty * cmp), sin repetir un
 * producto usado en los últimos DAYS_BEFORE_REPEAT días. Aplica descuento
 * escalonado por antigüedad y genera una línea de copy con IA. Persiste en
 * StatusPost para que al recargar se vean los mismos.
 *
 * Además de la selección automática, `addStatusPost` permite sumar estados a
 * demanda eligiendo el origen (liquidación, regular o un producto puntual).
 */

import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import type { ProductInsight, StatusPost } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { colombiaToday, colombiaDaysAgo } from "@/lib/timezone";

const SLOTS = 5;
const DAYS_BEFORE_REPEAT = 14;
const DISCOUNT_HIGH = 30; // rotationDays > 60
const DISCOUNT_LOW = 20;  // rotationDays 31..60

/** Cantidad de estados que se crean solos al abrir el día. */
export const DAILY_SLOTS = SLOTS;

/** El sync marca los productos archivados de Odoo con este sufijo en el nombre. */
export function isArchived(name: string): boolean {
  return name.endsWith(" (archivado)");
}

export function discountForRotation(rotationDays: number): number {
  return rotationDays > 60 ? DISCOUNT_HIGH : DISCOUNT_LOW;
}

/** Redondea a múltiplo de 100 COP para un precio "bonito". */
function roundPrice(n: number): number {
  return Math.max(0, Math.round(n / 100) * 100);
}

export function computeFinalPrice(salePrice: number, pct: number): number {
  return roundPrice(salePrice * (1 - pct / 100));
}

// ─── Copy IA ──────────────────────────────────────────────────────────────────

type CopyMode = "liquidacion" | "regular";

const copySchema = z.object({
  copy: z
    .string()
    .describe(
      "UNA sola línea corta (máx 40 caracteres) de gancho en español coloquial colombiano, puede empezar con un emoji. Sin el precio ni el nombre del producto."
    ),
});

const COPY_SYSTEM_PROMPT_LIQUIDACION = `Eres el community manager de Papelería Utilia (Sabaneta, Colombia).
Escribes ganchos cortísimos para Estados de WhatsApp de ofertas de liquidación.
Reglas:
- Una sola línea, máximo 40 caracteres.
- Español coloquial colombiano, cercano, con energía de venta.
- Puedes usar 1 emoji al inicio.
- NO incluyas el precio ni el nombre del producto (ya van en la imagen).
- Transmite urgencia o escasez cuando el stock es bajo.`;

const COPY_SYSTEM_PROMPT_REGULAR = `Eres el community manager de Papelería Utilia (Sabaneta, Colombia).
Escribes ganchos cortísimos para Estados de WhatsApp destacando productos del catálogo regular (NO son oferta ni liquidación).
Reglas:
- Una sola línea, máximo 40 caracteres.
- Español coloquial colombiano, cercano, con energía de venta.
- Puedes usar 1 emoji al inicio.
- NO incluyas el precio ni el nombre del producto (ya van en la imagen).
- NO menciones descuento, oferta ni urgencia falsa; destaca calidad, utilidad o popularidad del producto.`;

async function generateCopy(input: {
  name: string;
  stockQty: number;
  category: string | null;
  discountPct: number;
  mode: CopyMode;
}): Promise<string> {
  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: copySchema,
      system: input.mode === "regular" ? COPY_SYSTEM_PROMPT_REGULAR : COPY_SYSTEM_PROMPT_LIQUIDACION,
      prompt: `Producto: ${input.name}
Stock disponible: ${input.stockQty}
Categoría: ${input.category ?? "—"}
Descuento: ${input.discountPct}%

Genera el gancho.`,
    });
    return object.copy.trim().slice(0, 60);
  } catch {
    return fallbackCopy(input.stockQty, input.mode);
  }
}

function fallbackCopy(stockQty: number, mode: CopyMode): string {
  if (mode === "regular") return "✨ Recomendado del día";
  return stockQty <= 5 ? `🔥 ¡Últimas ${stockQty} unidades!` : "🔥 Oferta de liquidación";
}

// ─── Gancho (texto libre) ───────────────────────────────────────────────────

const ganchoSchema = z.object({
  headline: z.string().describe("Titular de intriga, máx 32 caracteres, puede empezar con emoji."),
  subhead: z.string().describe("Subtítulo breve que complementa el titular, máx 48 caracteres."),
});

const GANCHO_SYSTEM_PROMPT = `Eres el community manager de Papelería Utilia (Sabaneta, Colombia).
Escribes "ganchos" de intriga para Estados de WhatsApp: NO hay producto ni precio, solo generar curiosidad para que la gente siga viendo los siguientes estados.
Reglas:
- Titular: máximo 32 caracteres, con gancho, puede llevar 1 emoji.
- Subtítulo: máximo 48 caracteres, complementa sin revelar todo.
- Español coloquial colombiano, cercano.
- Nada de precios ni nombres de productos.`;

/** Sugiere titular + subtítulo para un gancho. `tema` opcional orienta a la IA. */
export async function suggestGanchoText(tema?: string): Promise<{ headline: string; subhead: string }> {
  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: ganchoSchema,
      system: GANCHO_SYSTEM_PROMPT,
      prompt: tema?.trim()
        ? `Tema o pista: ${tema.trim()}\n\nGenera el gancho.`
        : `Genera un gancho de intriga genérico para abrir la tanda de estados del día.`,
    });
    return {
      headline: object.headline.trim().slice(0, 40),
      subhead: object.subhead.trim().slice(0, 60),
    };
  } catch {
    return { headline: "👀 Se viene algo bueno", subhead: "Quédate pendiente de nuestros estados" };
  }
}

// ─── Selección ──────────────────────────────────────────────────────────────

export interface Candidate {
  odooProductId: number;
  name: string;
  category: string | null;
  stockQty: number;
  salePrice: number;
  rotationDays: number;
  invested: number;
}

function toCandidate(p: ProductInsight): Candidate {
  return {
    odooProductId: p.odooProductId,
    name: p.name,
    category: p.category,
    stockQty: Math.floor(p.stockQty),
    salePrice: p.salePrice,
    rotationDays: p.rotationDays,
    invested: p.stockQty * p.cmp,
  };
}

/** Vendible = con stock entero y precio de lista. */
function isSellable(c: Candidate): boolean {
  return c.stockQty > 0 && c.salePrice > 0;
}

/** Capital muerto ordenado por capital invertido desc. */
export async function rankedDeadStock(): Promise<Candidate[]> {
  const dead = await prisma.productInsight.findMany({
    where: { rotationDays: { gt: 30 }, stockQty: { gt: 0 } },
  });
  return dead
    .map(toCandidate)
    .filter(isSellable)
    .sort((a, b) => b.invested - a.invested);
}

/** Productos regulares (no capital muerto) con stock, para el selector manual. */
export async function rankedRegularStock(): Promise<Candidate[]> {
  const regular = await prisma.productInsight.findMany({
    where: { rotationDays: { lte: 30 }, stockQty: { gt: 0 } },
  });
  return regular
    .map(toCandidate)
    .filter(isSellable)
    .sort((a, b) => b.stockQty - a.stockQty);
}

async function recentlyPostedIds(): Promise<Set<number>> {
  const since = colombiaDaysAgo(DAYS_BEFORE_REPEAT);
  const recent = await prisma.statusPost.findMany({
    where: { date: { gte: since }, odooProductId: { not: null } },
    select: { odooProductId: true },
  });
  return new Set(recent.map((r) => r.odooProductId).filter((id): id is number => id != null));
}

/**
 * Deriva los campos de un estado a partir de un candidato: el capital muerto
 * va con descuento escalonado y copy de liquidación; el resto sin descuento y
 * con copy regular. Incluye la llamada a la IA, que es la parte lenta.
 */
async function postDataFromCandidate(c: Candidate) {
  const mode: CopyMode = c.rotationDays > 30 ? "liquidacion" : "regular";
  const discountPct = mode === "liquidacion" ? discountForRotation(c.rotationDays) : 0;
  const finalPrice = computeFinalPrice(c.salePrice, discountPct);
  const copy = await generateCopy({
    name: c.name,
    stockQty: c.stockQty,
    category: c.category,
    discountPct,
    mode,
  });
  return {
    odooProductId: c.odooProductId,
    productName: c.name,
    category: c.category,
    stockQty: c.stockQty,
    salePrice: c.salePrice,
    discountPct,
    finalPrice,
    copy,
  };
}

async function createPostFromCandidate(date: Date, slot: number, c: Candidate): Promise<StatusPost> {
  return prisma.statusPost.create({ data: { date, slot, ...(await postDataFromCandidate(c)) } });
}

/**
 * Devuelve los StatusPost de HOY (Colombia). Si no existen, los crea:
 * elige por capital invertido desc, excluye productos posteados en los
 * últimos DAYS_BEFORE_REPEAT días; si la cola se agota, reinicia (permite
 * repetir). Idempotente por el unique [date, slot].
 */
export async function getOrCreateTodayStatusPosts(): Promise<StatusPost[]> {
  const today = colombiaToday();
  const existing = await prisma.statusPost.findMany({
    where: { date: today },
    orderBy: { slot: "asc" },
  });
  if (existing.length > 0) return existing;

  const ranked = await rankedDeadStock();
  if (ranked.length === 0) return [];

  const recentIds = await recentlyPostedIds();
  let pool = ranked.filter((c) => !recentIds.has(c.odooProductId));
  if (pool.length < SLOTS) pool = ranked; // cola agotada → reiniciar

  // En paralelo: cada slot hace su propia llamada a la IA y son independientes
  // entre sí. En serie, la primera carga del día costaba la suma de las SLOTS
  // llamadas; así cuesta la más lenta.
  const chosen = pool.slice(0, SLOTS);
  const results = await Promise.allSettled(
    chosen.map((c, i) => createPostFromCandidate(today, i + 1, c))
  );

  // Un rechazo casi siempre es la carrera contra otra request que ya creó el
  // slot (unique [date, slot]). Recargamos para devolver la verdad de la BD.
  if (results.some((r) => r.status === "rejected")) {
    return prisma.statusPost.findMany({ where: { date: today }, orderBy: { slot: "asc" } });
  }
  return results.map((r) => (r as PromiseFulfilledResult<StatusPost>).value);
}

// ─── Alta a demanda ─────────────────────────────────────────────────────────

/** De dónde sale un estado nuevo creado a mano. */
export type NewPostOrigin =
  | { kind: "liquidacion" }
  | { kind: "regular" }
  | { kind: "producto"; odooProductId: number };

/**
 * Elige el mejor candidato automático de un pool, descartando archivados, los
 * productos ya usados hoy y los posteados hace poco. Si el filtro de recientes
 * deja el pool vacío, se ignora antes que fallar.
 */
function pickAuto(pool: Candidate[], usedToday: Set<number>, recentIds: Set<number>): Candidate | null {
  const available = pool.filter((c) => !isArchived(c.name) && !usedToday.has(c.odooProductId));
  const fresh = available.filter((c) => !recentIds.has(c.odooProductId));
  return fresh[0] ?? available[0] ?? null;
}

/** Estados de hoy (Colombia) con lo mínimo para calcular slot y evitar repetidos. */
async function todayContext() {
  const today = colombiaToday();
  const todays = await prisma.statusPost.findMany({
    where: { date: today },
    select: { slot: true, odooProductId: true },
  });
  const usedToday = new Set(
    todays.map((t) => t.odooProductId).filter((id): id is number => id != null)
  );
  const nextSlot = todays.reduce((max, t) => Math.max(max, t.slot), 0) + 1;
  return { today, usedToday, nextSlot };
}

/** Agrega un estado más al día de hoy en el siguiente slot libre. */
export async function addStatusPost(origin: NewPostOrigin): Promise<StatusPost> {
  const { today, usedToday, nextSlot } = await todayContext();

  let candidate: Candidate | null;
  if (origin.kind === "producto") {
    if (usedToday.has(origin.odooProductId)) {
      throw new Error("Ese producto ya está en otra tarjeta de hoy");
    }
    const insight = await prisma.productInsight.findUnique({
      where: { odooProductId: origin.odooProductId },
    });
    candidate = insight ? toCandidate(insight) : null;
    if (!candidate || !isSellable(candidate) || isArchived(candidate.name)) {
      throw new Error("Producto no disponible");
    }
  } else {
    const recentIds = await recentlyPostedIds();
    const pool = origin.kind === "liquidacion" ? await rankedDeadStock() : await rankedRegularStock();
    candidate = pickAuto(pool, usedToday, recentIds);
    if (!candidate) {
      throw new Error(
        origin.kind === "liquidacion"
          ? "No quedan productos de liquidación disponibles"
          : "No quedan productos regulares disponibles"
      );
    }
  }

  return createPostFromCandidate(today, nextSlot, candidate);
}

/** Trunca y limpia el texto del gancho; el titular es obligatorio. */
function cleanGancho(headline: string, subhead: string) {
  return {
    headline: headline.trim().slice(0, 60),
    subhead: subhead.trim().slice(0, 90) || null,
  };
}

/** Crea un estado de tipo gancho (texto libre, sin producto) en el siguiente slot. */
export async function addGanchoPost(headline: string, subhead: string): Promise<StatusPost> {
  const clean = cleanGancho(headline, subhead);
  if (!clean.headline) throw new Error("El titular no puede estar vacío");
  const { today, nextSlot } = await todayContext();
  return prisma.statusPost.create({
    data: { date: today, slot: nextSlot, kind: "GANCHO", headline: clean.headline, subhead: clean.subhead },
  });
}

/** Edita el texto de un gancho existente. */
export async function updateGanchoText(id: string, headline: string, subhead: string): Promise<StatusPost> {
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });
  if (post.kind !== "GANCHO") throw new Error("Este estado no es un gancho");
  const clean = cleanGancho(headline, subhead);
  if (!clean.headline) throw new Error("El titular no puede estar vacío");
  return prisma.statusPost.update({ where: { id }, data: clean });
}

// ─── Edición ──────────────────────────────────────────────────────────────

/** Reemplaza el producto de un slot por uno elegido a mano (liquidación o regular). */
export async function pickStatusPostProduct(id: string, odooProductId: number): Promise<StatusPost> {
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });

  const usedToday = await prisma.statusPost.findMany({
    where: { date: post.date, id: { not: id } },
    select: { odooProductId: true },
  });
  if (usedToday.some((u) => u.odooProductId === odooProductId)) {
    throw new Error("Ese producto ya está en otra tarjeta de hoy");
  }

  const insight = await prisma.productInsight.findUnique({ where: { odooProductId } });
  const candidate = insight ? toCandidate(insight) : null;
  if (!candidate || !isSellable(candidate) || isArchived(candidate.name)) {
    throw new Error("Producto no disponible");
  }

  return prisma.statusPost.update({
    where: { id },
    data: { ...(await postDataFromCandidate(candidate)), posted: false, postedAt: null },
  });
}

/** Regenera solo el copy IA de un estado (usa el modo del producto actual). */
export async function regenerateStatusPostCopy(id: string): Promise<StatusPost> {
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });
  if (post.kind !== "PRODUCT" || post.odooProductId == null || post.productName == null) {
    throw new Error("Este estado no tiene copy de producto");
  }
  const insight = await prisma.productInsight.findUnique({ where: { odooProductId: post.odooProductId } });
  const mode: CopyMode = insight && insight.rotationDays <= 30 ? "regular" : "liquidacion";
  const copy = await generateCopy({
    name: post.productName,
    stockQty: post.stockQty ?? 0,
    category: post.category,
    discountPct: post.discountPct ?? 0,
    mode,
  });
  return prisma.statusPost.update({ where: { id }, data: { copy } });
}

/** Cambia el % de descuento y recalcula el precio final. */
export async function updateStatusPostDiscount(id: string, pct: number): Promise<StatusPost> {
  const clamped = Math.min(90, Math.max(0, Math.round(pct)));
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });
  if (post.kind !== "PRODUCT" || post.salePrice == null) {
    throw new Error("Este estado no tiene precio");
  }
  const finalPrice = computeFinalPrice(post.salePrice, clamped);
  return prisma.statusPost.update({
    where: { id },
    data: { discountPct: clamped, finalPrice },
  });
}

/** Marca (o desmarca) un estado como publicado. */
export async function markStatusPostPosted(id: string, posted: boolean): Promise<void> {
  await prisma.statusPost.update({
    where: { id },
    data: { posted, postedAt: posted ? new Date() : null },
  });
}

/** Cambia la plantilla visual (A/B/C) de un estado. */
export async function updateStatusPostTemplate(
  id: string,
  template: "A" | "B" | "C"
): Promise<StatusPost> {
  return prisma.statusPost.update({ where: { id }, data: { template } });
}
