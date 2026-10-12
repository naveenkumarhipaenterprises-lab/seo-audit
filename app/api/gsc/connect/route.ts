import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { authorizationUrl, gscConfigured } from "@/lib/integrations/gsc";
import { ownerIdFromCookieHeader } from "@/lib/security/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts the Google OAuth flow (read-only Search Console scope). */
export async function GET(req: Request) {
  if (!gscConfigured()) return NextResponse.json({ error: "Search Console is not configured on this server." }, { status: 404 });
  if (!ownerIdFromCookieHeader(req.headers.get("cookie"))) return NextResponse.redirect(new URL("/settings?gsc=error", req.url));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizationUrl(state));
  res.cookies.set("ss_gsc_state", state, { httpOnly: true, sameSite: "lax", secure: new URL(req.url).protocol === "https:", path: "/api/gsc", maxAge: 600 });
  return res;
}
