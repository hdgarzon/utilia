/**
 * Selección diaria de "Estados de WhatsApp" para liquidar capital muerto.
 *
 * Cada día elige 3 productos de capital muerto (rotationDays > 30, stock > 0),
 * priorizando el mayor capital invertido (stockQty * cmp), sin repetir un
 * producto usado en los últimos DAYS_BEFORE_REPEAT días. Aplica descuento
 * escalonado por antigüedad y genera una línea de copy con IA. Persiste en
 * StatusPost para que al recargar se vean los mismos 3.
 */

import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import type { StatusPost } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { colombiaToday, colombiaDaysAgo } from "@/lib/timezone";

const SLOTS = 3;
const DAYS_BEFORE_REPEAT = 14;
const DISCOUNT_HIGH = 30; // rotationDays > 60
const DISCOUNT_LOW = 20;  // rotationDays 31..60

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

/** Capital muerto ordenado por capital invertido desc. */
export async function rankedDeadStock(): Promise<Candidate[]> {
  const dead = await prisma.productInsight.findMany({
    where: { rotationDays: { gt: 30 }, stockQty: { gt: 0 } },
  });
  return dead
    .map((p) => ({
      odooProductId: p.odooProductId,
      name: p.name,
      category: p.category,
      stockQty: Math.floor(p.stockQty),
      salePrice: p.salePrice,
      rotationDays: p.rotationDays,
      invested: p.stockQty * p.cmp,
    }))
    .filter((c) => c.stockQty > 0 && c.salePrice > 0)
    .sort((a, b) => b.invested - a.invested);
}

/** Productos regulares (no capital muerto) con stock, para el selector manual. */
export async function rankedRegularStock(): Promise<Candidate[]> {
  const regular = await prisma.productInsight.findMany({
    where: { rotationDays: { lte: 30 }, stockQty: { gt: 0 } },
  });
  return regular
    .map((p) => ({
      odooProductId: p.odooProductId,
      name: p.name,
      category: p.category,
      stockQty: Math.floor(p.stockQty),
      salePrice: p.salePrice,
      rotationDays: p.rotationDays,
      invested: p.stockQty * p.cmp,
    }))
    .filter((c) => c.stockQty > 0 && c.salePrice > 0)
    .sort((a, b) => b.stockQty - a.stockQty);
}

async function recentlyPostedIds(): Promise<Set<number>> {
  const since = colombiaDaysAgo(DAYS_BEFORE_REPEAT);
  const recent = await prisma.statusPost.findMany({
    where: { date: { gte: since } },
    select: { odooProductId: true },
  });
  return new Set(recent.map((r) => r.odooProductId));
}

async function createPostFromCandidate(date: Date, slot: number, c: Candidate): Promise<StatusPost> {
  const discountPct = discountForRotation(c.rotationDays);
  const finalPrice = computeFinalPrice(c.salePrice, discountPct);
  const copy = await generateCopy({
    name: c.name,
    stockQty: c.stockQty,
    category: c.category,
    discountPct,
    mode: "liquidacion",
  });
  return prisma.statusPost.create({
    data: {
      date,
      slot,
      odooProductId: c.odooProductId,
      productName: c.name,
      category: c.category,
      stockQty: c.stockQty,
      salePrice: c.salePrice,
      discountPct,
      finalPrice,
      copy,
    },
  });
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

  const chosen = pool.slice(0, SLOTS);
  const created: StatusPost[] = [];
  for (let i = 0; i < chosen.length; i++) {
    try {
      created.push(await createPostFromCandidate(today, i + 1, chosen[i]));
    } catch {
      // Carrera con otra request que ya creó este slot: recargar y salir.
      return prisma.statusPost.findMany({ where: { date: today }, orderBy: { slot: "asc" } });
    }
  }
  return created;
}

// ─── Edición ──────────────────────────────────────────────────────────────

/** Cambia el producto de un slot por el siguiente disponible en la cola. */
export async function swapStatusPostProduct(id: string): Promise<StatusPost> {
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });
  const usedToday = await prisma.statusPost.findMany({
    where: { date: post.date },
    select: { odooProductId: true },
  });
  const usedIds = new Set(usedToday.map((u) => u.odooProductId));
  const recentIds = await recentlyPostedIds();

  const ranked = await rankedDeadStock();
  const next =
    ranked.find((c) => !usedIds.has(c.odooProductId) && !recentIds.has(c.odooProductId)) ??
    ranked.find((c) => !usedIds.has(c.odooProductId));
  if (!next) return post; // no hay otro producto para ofrecer

  const discountPct = discountForRotation(next.rotationDays);
  const finalPrice = computeFinalPrice(next.salePrice, discountPct);
  const copy = await generateCopy({
    name: next.name,
    stockQty: next.stockQty,
    category: next.category,
    discountPct,
    mode: "liquidacion",
  });
  return prisma.statusPost.update({
    where: { id },
    data: {
      odooProductId: next.odooProductId,
      productName: next.name,
      category: next.category,
      stockQty: next.stockQty,
      salePrice: next.salePrice,
      discountPct,
      finalPrice,
      copy,
      posted: false,
      postedAt: null,
    },
  });
}

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

  const candidate = await prisma.productInsight.findUnique({ where: { odooProductId } });
  if (!candidate || candidate.stockQty <= 0 || candidate.salePrice <= 0) {
    throw new Error("Producto no disponible");
  }

  const mode: CopyMode = candidate.rotationDays > 30 ? "liquidacion" : "regular";
  const discountPct = mode === "liquidacion" ? discountForRotation(candidate.rotationDays) : 0;
  const finalPrice = computeFinalPrice(candidate.salePrice, discountPct);
  const copy = await generateCopy({
    name: candidate.name,
    stockQty: Math.floor(candidate.stockQty),
    category: candidate.category,
    discountPct,
    mode,
  });

  return prisma.statusPost.update({
    where: { id },
    data: {
      odooProductId: candidate.odooProductId,
      productName: candidate.name,
      category: candidate.category,
      stockQty: Math.floor(candidate.stockQty),
      salePrice: candidate.salePrice,
      discountPct,
      finalPrice,
      copy,
      posted: false,
      postedAt: null,
    },
  });
}

/** Regenera solo el copy IA de un estado (usa el modo del producto actual). */
export async function regenerateStatusPostCopy(id: string): Promise<StatusPost> {
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });
  const insight = await prisma.productInsight.findUnique({ where: { odooProductId: post.odooProductId } });
  const mode: CopyMode = insight && insight.rotationDays <= 30 ? "regular" : "liquidacion";
  const copy = await generateCopy({
    name: post.productName,
    stockQty: post.stockQty,
    category: post.category,
    discountPct: post.discountPct,
    mode,
  });
  return prisma.statusPost.update({ where: { id }, data: { copy } });
}

/** Cambia el % de descuento y recalcula el precio final. */
export async function updateStatusPostDiscount(id: string, pct: number): Promise<StatusPost> {
  const clamped = Math.min(90, Math.max(0, Math.round(pct)));
  const post = await prisma.statusPost.findUniqueOrThrow({ where: { id } });
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
