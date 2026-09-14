import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateRecommendations } from "@/lib/ai/recommendations";
import { isCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // hasta 2 min — generaciones LLM pueden tardar

async function authorize(req: NextRequest): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (isCronRequest(req)) return { ok: true };
  const session = await auth();
  if (session) return { ok: true };
  return { ok: false, reason: "unauthorized" };
}

export async function POST(req: NextRequest) {
  const guard = await authorize(req);
  if (!guard.ok) return NextResponse.json({ error: guard.reason }, { status: 401 });

  try {
    const result = await generateRecommendations();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: "Generation failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// Permite que el cron de Vercel lo dispare con GET + bearer secret
export const GET = POST;
