import { NextResponse } from "next/server";
import { disconnect } from "@/lib/integrations/gsc";
import { ownerIdFromCookieHeader } from "@/lib/security/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await disconnect(ownerIdFromCookieHeader(req.headers.get("cookie")));
  return NextResponse.json({ ok: true });
}
