import type { AuditRecord, PerformanceResult } from "./types";
import type { CheckContext } from "./checks/context";
import { performanceChecks } from "./checks/performance";
import { lighthouseAccessibilityCheck } from "./checks/accessibility";
import { computeScores } from "../scoring/score";
import { sourceOf } from "./record-utils";

/**
 * Re-runs PageSpeed Insights for a stored audit, replaces only the performance findings
 * and recalculates scores from the stored check list. The record keeps its original
 * audit time; each performance result carries its own fetchedAt.
 */
export async function retryPerformance(
  r: AuditRecord,
  pageSpeed: (url: string, strategy: "mobile" | "desktop", signal?: AbortSignal) => Promise<PerformanceResult>,
  signal?: AbortSignal,
): Promise<AuditRecord> {
  const pref = r.input.performanceStrategy || "both";
  const strategies: ("mobile" | "desktop")[] = pref === "both" ? ["mobile", "desktop"] : [pref];
  const fresh = await Promise.all(strategies.map((s) => pageSpeed(r.finalUrl, s, signal)));
  // Keep a previous successful result rather than replacing it with a new failure.
  const performance = strategies.map((s, i) => (fresh[i].status === "ok" ? fresh[i] : r.performance.find((p) => p.strategy === s && p.status === "ok") || fresh[i]));
  const ctx = { input: { ...r.input, performanceStrategy: pref }, url: r.finalUrl, performance } as unknown as CheckContext;
  const at = new Date().toISOString();
  const perf = performanceChecks(ctx).map((c) => ({ ...c, source: sourceOf(c), detectedAt: at }));
  const lh = lighthouseAccessibilityCheck(ctx);
  const checks = [...r.checks.filter((c) => c.category !== "performance" && c.id !== "lighthouse-accessibility"), ...perf, ...lh];
  const scores = computeScores(checks);
  const partialReasons = r.partialReasons.filter((p) => !p.startsWith("Performance (")).concat(performance.filter((p) => p.status !== "ok").map((p) => `Performance (${p.strategy}): ${p.error}`));
  const renderFailed = r.render.status !== "ok" && r.input.renderJs && r.integrations.rendering === "Enabled";
  const status = partialReasons.length || scores.overall.partial || renderFailed ? "partial" : (r.warnings || []).length ? "completed_with_warnings" : "completed";
  return {
    ...r,
    performance,
    checks,
    scores,
    partialReasons,
    status,
    limitations: r.limitations.filter((l) => !l.startsWith("Performance (")).concat(partialReasons.filter((p) => p.startsWith("Performance ("))),
  };
}

