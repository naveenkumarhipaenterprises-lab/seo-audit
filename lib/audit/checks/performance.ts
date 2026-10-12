import { builder, type CheckContext } from "./context";
import type { CheckResult, CheckStatus } from "../types";

// Thresholds from web.dev Core Web Vitals / Lighthouse guidance (good / needs improvement).
const LAB_THRESHOLDS: Record<string, [number, number, (v: number) => string]> = {
  LCP: [2500, 4000, (v) => `${(v / 1000).toFixed(1)} s`],
  FCP: [1800, 3000, (v) => `${(v / 1000).toFixed(1)} s`],
  TBT: [200, 600, (v) => `${Math.round(v)} ms`],
  CLS: [0.1, 0.25, (v) => v.toFixed(3)],
  "Speed Index": [3400, 5800, (v) => `${(v / 1000).toFixed(1)} s`],
};

export function performanceChecks(ctx: CheckContext): CheckResult[] {
  const b = builder("performance", "Performance", ctx.url);
  const out: CheckResult[] = [];
  for (const strategy of ["mobile", "desktop"] as const) {
    const r = ctx.performance.find((p) => p.strategy === strategy);
    const label = strategy === "mobile" ? "Mobile" : "Desktop";
    if (!r || r.status !== "ok" || r.score === null) {
      out.push(b(`perf-score-${strategy}`, `${label} performance score`, "not_tested", "high",
        r?.error || "Performance was not tested.", "Run the audit with performance tests enabled; configure PAGESPEED_API_KEY for reliable quota.",
        "Google PageSpeed Insights (Lighthouse lab test)."));
      continue;
    }
    const st: CheckStatus = r.score >= 90 ? "pass" : r.score >= 50 ? "warning" : "fail";
    const c = { ...b(`perf-score-${strategy}`, `${label} performance score`, st, "high",
      `Lighthouse ${strategy} performance score: ${r.score}/100 (lab data${r.lighthouseVersion ? `, Lighthouse ${r.lighthouseVersion}` : ""}).`,
      st === "pass" ? "No action needed." : "Address the top Lighthouse opportunities listed below.",
      "Google PageSpeed Insights API, Lighthouse lab run.",
      r.opportunities.slice(0, 5).map((o) => `${o.title}${o.display ? ` — ${o.display}` : ""}`),
      "Lab scores vary between runs and differ from real-user (field) data."), measuredScore: r.score };
    out.push(c);
    for (const [metric, [good, poor, fmt]] of Object.entries(LAB_THRESHOLDS)) {
      const v = r.lab[metric]?.value;
      if (v === null || v === undefined) continue;
      const status: CheckStatus = v <= good ? "pass" : v <= poor ? "warning" : "fail";
      out.push(b(`perf-${metric.toLowerCase().replace(/\s/g, "-")}-${strategy}`, `${label} ${metric} (lab)`, status, "medium",
        `${metric} measured ${fmt(v)} in the ${strategy} lab test (good ≤ ${fmt(good)}).`,
        status === "pass" ? "No action needed." : `Improve ${metric}; see Lighthouse diagnostics.`, "Lighthouse lab measurement via PageSpeed Insights."));
    }
    const f = r.field;
    out.push(b(`perf-field-${strategy}`, `${label} real-user (field) data`, "info", "low",
      f.source === "none" ? "Chrome UX Report has no field data for this URL or origin (not enough real-user traffic)." :
        `Field data from the Chrome UX Report (${f.source === "origin" ? "origin-level fallback" : "this URL"}), overall: ${f.overall || "n/a"}.`,
      "Field data reflects real users over the previous 28 days.", "PageSpeed Insights loadingExperience.",
      Object.entries(f.metrics).map(([k, m]) => `${k} p75: ${m.p75 ?? "n/a"}${k === "CLS" ? "" : " ms"} (${m.category ?? "n/a"})`),
      "INP is only available as field data; it is not invented when CrUX has no data."));
  }
  return out;
}
