import { NextResponse } from "next/server";
import { defaultDeps } from "@/lib/audit/deps";
import { parseAuditInput } from "@/lib/audit/input";
import { findDuplicate, startJob, view } from "@/lib/audit/jobs";
import { normalizeAndValidateUrl, UrlValidationError } from "@/lib/security/url";
import { acquireAuditSlot, checkRateLimit, clientKey } from "@/lib/security/rate-limit";
import { ownerIdFromCookieHeader } from "@/lib/security/owner";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Validates the settings and starts a background audit job. Returns 202 with the job id;
 * progress is read from GET /api/audit/jobs/:id and cancelled with POST …/cancel.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = parseAuditInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    normalizeAndValidateUrl(parsed.input.url);
    for (const c of parsed.input.competitorUrls || []) {
      try {
        normalizeAndValidateUrl(c);
      } catch (e) {
        if (e instanceof UrlValidationError) return NextResponse.json({ error: `Competitor URL "${c.slice(0, 80)}": ${e.message}` }, { status: 400 });
        throw e;
      }
    }
  } catch (e) {
    if (e instanceof UrlValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const owner = ownerIdFromCookieHeader(req.headers.get("cookie"));
  const dup = findDuplicate(owner, parsed.input);
  if (dup) return NextResponse.json({ jobId: dup.id, job: view(dup), duplicate: true }, { status: 200 });
  const rl = checkRateLimit(clientKey(req.headers));
  if (!rl.ok) return NextResponse.json({ error: `Too many audits. Try again in ${rl.retryAfterSec}s.` }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  const release = acquireAuditSlot();
  if (!release) return NextResponse.json({ error: "The server is busy running other audits. Please try again shortly." }, { status: 503 });
  const job = startJob(parsed.input, owner, defaultDeps(), getStore(), release);
  return NextResponse.json({ jobId: job.id, job: view(job) }, { status: 202, headers: { "cache-control": "no-store" } });
}
