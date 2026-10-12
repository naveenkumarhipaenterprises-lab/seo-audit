import { NextResponse } from "next/server";
import { exchangeCode, gscConfigured } from "@/lib/integrations/gsc";
import { ownerIdFromCookieHeader } from "@/lib/security/owner";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/settings?gsc=${q}`, req.url));
    res.cookies.set("ss_gsc_state", "", { path: "/api/gsc", maxAge: 0 });
    return res;
  };
  if (!gscConfigured()) return back("error");
  const cookie = req.headers.get("cookie") || "";
  const state = cookie.match(/(?:^|;\s*)ss_gsc_state=([a-f0-9]+)/)?.[1];
  const owner = ownerIdFromCookieHeader(cookie);
  if (!state || state !== url.searchParams.get("state") || !owner) return back("error");
  const code = url.searchParams.get("code");
  if (!code) return back("denied");
  try {
    await exchangeCode(owner, code);
    return back("connected");
  } catch (e) {
    log("warn", "gsc.exchange_failed", { message: (e as Error).message });
    return back("error");
  }
}
