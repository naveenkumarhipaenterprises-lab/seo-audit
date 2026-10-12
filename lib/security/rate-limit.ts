import { LIMITS } from "../config";

/**
 * In-memory fixed-window rate limiter and concurrency gate. Adequate for a single
 * server instance; multi-instance deployments should move this to a shared store
 * (for example Upstash Redis or a Supabase table) before going public.
 */
const hits = new Map<string, { count: number; resetAt: number }>();
let running = 0;

export function checkRateLimit(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + LIMITS.rateWindowMs });
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    return { ok: true };
  }
  if (entry.count >= LIMITS.auditsPerIpPerWindow) {
    return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { ok: true };
}

export function acquireAuditSlot(): (() => void) | null {
  if (running >= LIMITS.maxConcurrentAudits) return null;
  running++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      running--;
    }
  };
}

export function clientKey(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || headers.get("x-real-ip") || "local";
}

export function _resetRateLimitForTests() {
  hits.clear();
  running = 0;
}
