import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { ownerIdFromCookieHeader } from "@/lib/security/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return NextResponse.json({ audits: await getStore().list(ownerIdFromCookieHeader(req.headers.get("cookie")), 100) }, { headers: { "cache-control": "no-store" } });
}
