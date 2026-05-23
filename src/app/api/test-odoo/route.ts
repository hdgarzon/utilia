import { NextResponse } from "next/server";
import { odoo } from "@/lib/odoo";

export async function GET() {
  const result = await odoo.testConnection();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
