import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  const diagnostics: Record<string, unknown> = {
    env: {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      hasDirectUrl: !!process.env.DIRECT_URL,
      databaseUrlHost: process.env.DATABASE_URL?.match(/@([^:/]+)/)?.[1] ?? null,
      directUrlHost: process.env.DIRECT_URL?.match(/@([^:/]+)/)?.[1] ?? null,
      databaseUrlPort: process.env.DATABASE_URL?.match(/:(\d+)\//)?.[1] ?? null,
    },
  };

  try {
    const userCount = await prisma.user.count();
    diagnostics.userCount = userCount;
  } catch (e) {
    diagnostics.userCountError = e instanceof Error ? e.message : String(e);
  }

  try {
    const productCount = await prisma.productInsight.count();
    diagnostics.productCount = productCount;
  } catch (e) {
    diagnostics.productCountError = e instanceof Error ? e.message : String(e);
  }

  try {
    const sample = await prisma.productInsight.findMany({
      take: 3,
      select: { id: true, name: true, stockQty: true, daysOfStock: true },
    });
    diagnostics.sampleProducts = sample;
  } catch (e) {
    diagnostics.sampleProductsError = e instanceof Error ? e.message : String(e);
  }

  try {
    const critical = await prisma.productInsight.findMany({
      where: { daysOfStock: { lt: 5 } },
      take: 2,
      select: { name: true, daysOfStock: true },
    });
    diagnostics.criticalCount = critical.length;
    diagnostics.criticalSample = critical;
  } catch (e) {
    diagnostics.criticalError = e instanceof Error ? e.message : String(e);
  }

  diagnostics.durationMs = Date.now() - start;
  return NextResponse.json(diagnostics, { status: 200 });
}
