import { NextRequest, NextResponse } from "next/server";
import { runFullSync } from "@/lib/sync";
import { auth } from "@/lib/auth";
import { generateRecommendations } from "@/lib/ai/recommendations";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — el sync inicial puede ser largo

/**
 * GET /api/sync
 *
 * Llamado por Vercel Cron (cada 5 min, configurado en vercel.json).
 * Vercel firma la request con `Authorization: Bearer ${CRON_SECRET}`.
 *
 * También sirve como health check del estado de sync (sin secret).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  // Sin secret: devolver estado actual (no ejecuta sync)
  if (!isCron) {
    const { prisma } = await import("@/lib/prisma");
    const states = await prisma.syncState.findMany();
    return NextResponse.json({ states, cron: false });
  }

  // Con secret válido: ejecutar sync completo + regenerar recomendaciones IA
  const t0 = Date.now();
  try {
    const results = await runFullSync();
    const summary = results.map((r, i) => ({
      job: ["products", "stock", "sales", "purchases"][i],
      status: r.status,
      ...(r.status === "fulfilled" ? r.value : { error: String(r.reason?.message ?? r.reason) }),
    }));
    // Después del sync exitoso, generar recomendaciones nuevas (no bloquea
    // la respuesta si falla — log y seguir).
    let aiResult: unknown = null;
    try {
      aiResult = await generateRecommendations();
    } catch (aiErr) {
      aiResult = { error: aiErr instanceof Error ? aiErr.message : String(aiErr) };
    }
    return NextResponse.json({ ok: true, durationMs: Date.now() - t0, summary, ai: aiResult });
  } catch (err) {
    return NextResponse.json(
      { error: "Sync failed", detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sync
 *
 * Trigger manual desde la UI. Requiere sesión NextAuth.
 */
export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  try {
    const results = await runFullSync();
    const summary = results.map((r, i) => ({
      job: ["products", "stock", "sales", "purchases"][i],
      status: r.status,
      ...(r.status === "fulfilled" ? r.value : { error: String(r.reason?.message ?? r.reason) }),
    }));
    return NextResponse.json({ ok: true, durationMs: Date.now() - t0, summary });
  } catch (err) {
    return NextResponse.json(
      { error: "Sync failed", detail: String(err) },
      { status: 500 }
    );
  }
}
