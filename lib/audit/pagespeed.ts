import "server-only";
import { request } from "undici";
import type { PerformanceResult } from "./types";
import { LIMITS } from "../config";
import { apiDispatcher } from "../security/safe-fetch";

const LAB_AUDITS: Record<string, string> = {
  "largest-contentful-paint": "LCP",
  "first-contentful-paint": "FCP",
  "speed-index": "Speed Index",
  "total-blocking-time": "TBT",
  "cumulative-layout-shift": "CLS",
};
const FIELD_METRICS: Record<string, string> = {
  LARGEST_CONTENTFUL_PAINT_MS: "LCP",
  INTERACTION_TO_NEXT_PAINT: "INP",
  CUMULATIVE_LAYOUT_SHIFT_SCORE: "CLS",
  FIRST_CONTENTFUL_PAINT_MS: "FCP",
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: "TTFB",
};

export function notTestedPerformance(strategy: "mobile" | "desktop", reason: string): PerformanceResult {
  return { strategy, status: "not_tested", error: reason, score: null, lab: {}, field: { source: "none", overall: null, metrics: {} }, opportunities: [] };
}

type Lhr = {
  lighthouseVersion?: string;
  fetchTime?: string;
  categories?: Record<string, { score: number | null } | undefined>;
  audits?: Record<string, { title?: string; score?: number | null; numericValue?: number; displayValue?: string; details?: { type?: string; overallSavingsMs?: number } }>;
};
type Experience = { id?: string; overall_category?: string; origin_fallback?: boolean; metrics?: Record<string, { percentile?: number; category?: string }> };

/** Converts a raw PageSpeed Insights v5 response into the stored shape. Exported for tests. */
export function parsePsiResponse(strategy: "mobile" | "desktop", json: { lighthouseResult?: Lhr; loadingExperience?: Experience; originLoadingExperience?: Experience }): PerformanceResult {
  const lhr = json.lighthouseResult;
  if (!lhr) return { ...notTestedPerformance(strategy, "PageSpeed returned no Lighthouse result."), status: "error" };
  const lab: PerformanceResult["lab"] = {};
  for (const [id, label] of Object.entries(LAB_AUDITS)) {
    const a = lhr.audits?.[id];
    lab[label] = { value: a?.numericValue ?? null, display: a?.displayValue ?? null, score: a?.score ?? null };
  }
  let exp: Experience | undefined = json.loadingExperience;
  let source: PerformanceResult["field"]["source"] = "none";
  if (exp?.metrics && Object.keys(exp.metrics).length) source = exp.origin_fallback ? "origin" : "url";
  else if (json.originLoadingExperience?.metrics && Object.keys(json.originLoadingExperience.metrics).length) {
    exp = json.originLoadingExperience;
    source = "origin";
  } else exp = undefined;
  const metrics: PerformanceResult["field"]["metrics"] = {};
  if (exp?.metrics) {
    for (const [k, label] of Object.entries(FIELD_METRICS)) {
      const m = exp.metrics[k];
      if (!m) continue;
      const p75 = m.percentile ?? null;
      metrics[label] = { p75: label === "CLS" && p75 !== null ? p75 / 100 : p75, category: m.category ?? null };
    }
  }
  const opportunities = Object.entries(lhr.audits || {})
    .filter(([, a]) => a.details?.type === "opportunity" && (a.score ?? 1) < 0.9)
    .map(([id, a]) => ({ id, title: a.title || id, display: a.displayValue ?? null, savingsMs: a.details?.overallSavingsMs ?? null }))
    .sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0))
    .slice(0, 8);
  const cat = (k: string) => {
    const v = lhr.categories?.[k]?.score;
    return typeof v === "number" ? Math.round(v * 100) : null;
  };
  return {
    strategy,
    status: "ok",
    fetchedAt: lhr.fetchTime,
    lighthouseVersion: lhr.lighthouseVersion,
    score: cat("performance"),
    categories: { performance: cat("performance"), accessibility: cat("accessibility"), bestPractices: cat("best-practices"), seo: cat("seo") },
    lab,
    field: { source, overall: exp?.overall_category ?? null, metrics },
    opportunities,
  };
}

/** Endpoint from the PageSpeed Insights v5 REST reference (runPagespeed). Override for testing only. */
export const PSI_ENDPOINT = process.env.PAGESPEED_ENDPOINT || "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed";
/** Lighthouse categories requested; the API accepts the parameter repeatedly. */
export const PSI_CATEGORIES = ["PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES", "SEO"] as const;

const cache = new Map<string, { at: number; result: PerformanceResult }>();
/** Short-lived cache so a retry or a repeat audit minutes later does not spend quota twice. Results keep their original fetchedAt. */
export async function runPageSpeedCached(url: string, strategy: "mobile" | "desktop", signal?: AbortSignal, fresh = false): Promise<PerformanceResult> {
  const key = `${strategy}|${url}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < LIMITS.psiCacheMs) return { ...hit.result, cached: true };
  let r = await runPageSpeed(url, strategy, signal);
  // One retry with backoff for transient server errors (not for quota or bad-request errors).
  if (r.status === "error" && !r.quota && /HTTP 5\d\d|timed out/.test(r.error || "") && !signal?.aborted) {
    await new Promise((res) => setTimeout(res, 2000));
    r = await runPageSpeed(url, strategy, signal);
  }
  if (r.status === "ok") {
    cache.set(key, { at: Date.now(), result: r });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  }
  return r;
}

/**
 * Calls the Google PageSpeed Insights API. Google's servers fetch the target URL, so
 * this request never reaches the audited site from our infrastructure. Works without
 * a key at a low shared quota; set PAGESPEED_API_KEY for reliable use (free tier).
 */
export async function runPageSpeed(url: string, strategy: "mobile" | "desktop", signal?: AbortSignal): Promise<PerformanceResult> {
  const params = new URLSearchParams({ url, strategy: strategy.toUpperCase() });
  for (const c of PSI_CATEGORIES) params.append("category", c);
  const key = process.env.PAGESPEED_API_KEY;
  if (key) params.set("key", key);
  try {
    const timeout = AbortSignal.timeout(LIMITS.psiTimeoutMs);
    const res = await request(`${PSI_ENDPOINT}?${params}`, {
      dispatcher: apiDispatcher(),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headersTimeout: LIMITS.psiTimeoutMs,
      bodyTimeout: LIMITS.psiTimeoutMs,
    });
    const text = await res.body.text();
    if (res.statusCode !== 200) {
      let msg = `PageSpeed Insights returned HTTP ${res.statusCode}.`;
      try {
        const err = JSON.parse(text)?.error;
        if (res.statusCode === 429) msg = key ? "PageSpeed Insights quota exceeded for the configured key." : "PageSpeed Insights shared quota exceeded. Add a PAGESPEED_API_KEY.";
        else if (err?.message) msg = `PageSpeed Insights: ${String(err.message).replace(/key=[^&\s]+/g, "key=***").slice(0, 200)}`;
      } catch {}
      return { ...notTestedPerformance(strategy, msg), status: "error", quota: res.statusCode === 429 };
    }
    return parsePsiResponse(strategy, JSON.parse(text));
  } catch (e) {
    const name = (e as Error).name;
    const msg = name === "TimeoutError" ? "PageSpeed Insights timed out." : name === "AbortError" ? "Cancelled." : "PageSpeed Insights request failed.";
    return { ...notTestedPerformance(strategy, msg), status: "error" };
  }
}
