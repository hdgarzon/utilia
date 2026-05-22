import { NextRequest, NextResponse } from "next/server";
import { runFullSync } from "@/lib/sync";
import { auth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runFullSync();
    const errors = results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason?.message);
    return NextResponse.json({ ok: true, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    return NextResponse.json({ error: "Sync failed", detail: String(err) }, { status: 500 });
  }
}

export async function GET() {
  const { prisma } = await import("@/lib/prisma");
  const states = await prisma.syncState.findMany();
  return NextResponse.json(states);
}
