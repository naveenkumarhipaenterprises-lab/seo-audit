import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ audits: await getStore().list(100) }, { headers: { "cache-control": "no-store" } });
}
