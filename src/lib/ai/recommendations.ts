/**
 * Motor de recomendaciones IA: detector heurístico → enriquecimiento con LLM
 * → persistencia idempotente en AIRecommendation.
 *
 * El detector produce señales crudas. El LLM las convierte en texto accionable
 * en español con tono Utilia. Las recomendaciones existentes no se regeneran
 * (dedupe por `entityId + type`) para mantener costos bajos.
 */

import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { detectAllSignals, type Signal } from "./detector";

const recommendationSchema = z.object({
  title: z.string().describe("Título corto y accionable, max 60 caracteres"),
  content: z
    .string()
    .describe(
      "Recomendación de 1-2 frases, tono profesional pero cercano. Incluye el dato más importante (cantidad, precio, días) que justifica la acción."
    ),
  impact: z
    .number()
    .nullable()
    .describe("Impacto monetario estimado en COP (puede ser null si no aplica)"),
});

const SYSTEM_PROMPT = `Eres el asistente de inteligencia operativa de Utilia, una papelería moderna de Sabaneta, Colombia.

Tu trabajo: convertir señales del sistema en recomendaciones cortas, en español, que el operador pueda ejecutar HOY.

Reglas estrictas:
- 1-2 frases máximo
- Tono profesional pero cercano (tutea, no usa "usted")
- Incluye SIEMPRE el dato numérico clave (cantidad, precio, días, %, capital inmovilizado)
- No uses jerga técnica ni anglicismos innecesarios
- No repitas el nombre del producto en el título si ya viene en el contexto
- Usa pesos colombianos (COP) formateados como "$X" sin decimales
- No inventes datos: usa solo los hechos provistos`;

function buildPromptForSignal(signal: Signal): string {
  const factsLines = Object.entries(signal.facts)
    .map(([k, v]) => `  - ${k}: ${typeof v === "number" ? v.toLocaleString("es-CO") : v}`)
    .join("\n");

  const typeLabel = {
    restock: "REABASTECIMIENTO URGENTE",
    stale: "PRODUCTO SIN ROTACIÓN",
    hot: "PRODUCTO TOP — OPORTUNIDAD DE CAMPAÑA",
    low_margin: "MARGEN BAJO — REVISAR PRECIO",
    no_sales_high_stock: "CAPITAL INMOVILIZADO EN STOCK",
  }[signal.type];

  return `Tipo de señal: ${typeLabel}
Producto: ${signal.productName}
Datos:
${factsLines}

Genera una recomendación que el operador pueda accionar en menos de 2 minutos.`;
}

async function enrichWithLLM(signal: Signal) {
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: recommendationSchema,
    instructions: SYSTEM_PROMPT,
    prompt: buildPromptForSignal(signal),
    temperature: 0.4,
  });
  return object;
}

export interface GenerationResult {
  detected: number;
  generated: number;
  skipped: number;
  errors: Array<{ key: string; error: string }>;
  durationMs: number;
}

export async function generateRecommendations(): Promise<GenerationResult> {
  const t0 = Date.now();
  const errors: Array<{ key: string; error: string }> = [];

  const signals = await detectAllSignals();

  // Dedup: descartar señales que ya tienen recomendación activa (no aplicada, no descartada, no expirada)
  const activeRecs = await prisma.aIRecommendation.findMany({
    where: {
      applied: false,
      dismissed: false,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { type: true, entityId: true },
  });
  const activeKeys = new Set(activeRecs.map((r) => `${r.type}:${r.entityId}`));

  const newSignals = signals.filter(
    (s) => !activeKeys.has(`${s.type}:${s.odooProductId}`)
  );

  if (newSignals.length === 0) {
    return {
      detected: signals.length,
      generated: 0,
      skipped: signals.length,
      errors,
      durationMs: Date.now() - t0,
    };
  }

  // Procesar en lotes de 5 en paralelo para no saturar la API
  const CHUNK = 5;
  let generated = 0;
  for (let i = 0; i < newSignals.length; i += CHUNK) {
    const batch = newSignals.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      batch.map(async (signal) => {
        const llm = await enrichWithLLM(signal);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        await prisma.aIRecommendation.create({
          data: {
            type: signal.type,
            priority: signal.priority,
            title: llm.title,
            content: llm.content,
            entityType: "product",
            entityId: String(signal.odooProductId),
            impact: llm.impact ?? null,
            expiresAt,
          },
        });
      })
    );
    for (const [idx, r] of results.entries()) {
      if (r.status === "fulfilled") {
        generated += 1;
      } else {
        errors.push({
          key: batch[idx].key,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  }

  return {
    detected: signals.length,
    generated,
    skipped: signals.length - newSignals.length,
    errors,
    durationMs: Date.now() - t0,
  };
}
