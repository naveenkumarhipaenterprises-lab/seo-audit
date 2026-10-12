import { NextResponse } from "next/server";
import { getStore, isValidAuditId } from "@/lib/store";
import { ownerIdFromCookieHeader } from "@/lib/security/owner";
import { retryPerformance } from "@/lib/audit/retry-performance";
import { runPageSpeedCached } from "@/lib/audit/pagespeed";
import { checkRateLimit, clientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Re-runs only the PageSpeed Insights tests for a saved audit and re-scores it. Other findings are preserved. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidAuditId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const store = getStore();
  const r = await store.get(id, ownerIdFromCookieHeader(req.headers.get("cookie")));
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rl = checkRateLimit(clientKey(req.headers));
  if (!rl.ok) return NextResponse.json({ error: `Too many requests. Try again in ${rl.retryAfterSec}s.` }, { status: 429 });
  const updated = await retryPerformance(r, (u, s, sig) => runPageSpeedCached(u, s, sig, true), req.signal);
  await store.save(updated);
  const ok = updated.performance.filter((p) => p.status === "ok").length;
  return NextResponse.json({ ok, performance: updated.performance, status: updated.status });
}
