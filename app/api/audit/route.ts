import { NextResponse } from "next/server";
import { runAudit, AuditAbortedError, AuditFailedError } from "@/lib/audit/run";
import { defaultDeps } from "@/lib/audit/deps";
import { parseAuditInput } from "@/lib/audit/input";
import { normalizeAndValidateUrl, UrlValidationError } from "@/lib/security/url";
import { acquireAuditSlot, checkRateLimit, clientKey } from "@/lib/security/rate-limit";
import type { AuditEvent } from "@/lib/audit/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Starts an audit and streams newline-delimited JSON events as each stage really
 * completes. Closing the request (client abort) cancels the audit.
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
  } catch (e) {
    if (e instanceof UrlValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const rl = checkRateLimit(clientKey(req.headers));
  if (!rl.ok) return NextResponse.json({ error: `Too many audits. Try again in ${rl.retryAfterSec}s.` }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  const release = acquireAuditSlot();
  if (!release) return NextResponse.json({ error: "The server is busy running other audits. Please try again shortly." }, { status: 503 });

  const encoder = new TextEncoder();
  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      let closed = false;
      const send = (e: AuditEvent) => {
        if (closed) return;
        try {
          c.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        await runAudit(parsed.input, defaultDeps(), send, controller.signal);
      } catch (e) {
        if (e instanceof AuditAbortedError || controller.signal.aborted) send({ type: "error", message: "The audit was cancelled." });
        else if (e instanceof AuditFailedError) send({ type: "error", message: e.message, stage: e.stage });
        else {
          console.error("audit failed", (e as Error)?.name, (e as Error)?.message);
          send({ type: "error", message: "The audit failed unexpectedly. Please try again." });
        }
      } finally {
        release();
        closed = true;
        try {
          c.close();
        } catch {}
      }
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
