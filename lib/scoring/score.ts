import { CATEGORY_LABELS, type Category, type CheckResult, type CheckStatus, type Scores } from "../audit/types";
import { CHECK_WEIGHT_OVERRIDES, METHODOLOGY_VERSION, OVERALL_WEIGHTS, SEO_COMPONENT_WEIGHTS, SEVERITY_WEIGHTS, STATUS_CREDIT } from "./weights";

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];
const round = (n: number) => Math.round(n);

export function checkPoints(c: CheckResult): number {
  return CHECK_WEIGHT_OVERRIDES[c.id] ?? SEVERITY_WEIGHTS[c.severity];
}

export function isScored(c: CheckResult): boolean {
  if (c.category === "performance") return c.measuredScore !== undefined;
  return c.status === "pass" || c.status === "warning" || c.status === "fail";
}

/** Weighted mean over components that have a score; weights of missing components are redistributed. */
function combine<T extends { weight: number; score: number | null }>(parts: T[]) {
  const avail = parts.filter((p) => p.score !== null);
  const total = avail.reduce((s, p) => s + p.weight, 0);
  if (!total) return { score: null, parts: parts.map((p) => ({ ...p, effectiveWeight: 0, contribution: null as number | null })) };
  const withContrib = parts.map((p) => {
    const effectiveWeight = p.score === null ? 0 : p.weight / total;
    return { ...p, effectiveWeight, contribution: p.score === null ? null : Math.round(p.score * effectiveWeight * 10) / 10 };
  });
  return { score: round(avail.reduce((s, p) => s + (p.score as number) * (p.weight / total), 0)), parts: withContrib };
}

/**
 * Deterministic scoring. Given the same stored checks this always returns the same
 * scores, so any report can be re-derived from its check list.
 */
export function computeScores(checks: CheckResult[]): Scores {
  const categories = {} as Scores["categories"];
  for (const cat of CATEGORIES) {
    const list = checks.filter((c) => c.category === cat);
    const counts: Record<CheckStatus, number> = { pass: 0, warning: 0, fail: 0, info: 0, not_applicable: 0, not_tested: 0 };
    list.forEach((c) => counts[c.status]++);
    let score: number | null = null;
    let earned = 0;
    let possible = 0;
    if (cat === "performance") {
      // Performance uses Lighthouse's own score (mean of tested strategies), not a re-weighting of metrics.
      const measured = list.filter((c) => c.measuredScore !== undefined).map((c) => c.measuredScore as number);
      if (measured.length) {
        earned = measured.reduce((a, b) => a + b, 0);
        possible = measured.length * 100;
        score = round(earned / measured.length);
      }
    } else {
      for (const c of list.filter(isScored)) {
        const pts = checkPoints(c);
        possible += pts;
        earned += pts * STATUS_CREDIT[c.status as keyof typeof STATUS_CREDIT];
      }
      score = possible ? round((earned / possible) * 100) : null;
    }
    categories[cat] = { category: cat, label: CATEGORY_LABELS[cat], score, earned: Math.round(earned * 10) / 10, possible, counts };
  }

  const seoParts = (Object.entries(SEO_COMPONENT_WEIGHTS) as [Category, number][]).map(([category, weight]) => ({ category, weight, score: categories[category].score }));
  const seo = combine(seoParts);
  const overallParts = [
    { name: "SEO" as const, weight: OVERALL_WEIGHTS.SEO, score: seo.score },
    { name: "AEO" as const, weight: OVERALL_WEIGHTS.AEO, score: categories.aeo.score },
    { name: "GEO" as const, weight: OVERALL_WEIGHTS.GEO, score: categories.geo.score },
  ];
  const overall = combine(overallParts);
  const tested = checks.filter((c) => c.status !== "info" && c.status !== "not_applicable");
  return {
    methodologyVersion: METHODOLOGY_VERSION,
    categories,
    seo: { score: seo.score, components: seo.parts.map(({ category, weight, score, contribution }) => ({ category, weight, score, contribution })) },
    overall: {
      score: overall.score,
      formula: `Overall = SEO × ${OVERALL_WEIGHTS.SEO}% + AEO × ${OVERALL_WEIGHTS.AEO}% + GEO × ${OVERALL_WEIGHTS.GEO}% (weights of untested components are redistributed proportionally). SEO = ${Object.entries(SEO_COMPONENT_WEIGHTS).map(([k, v]) => `${CATEGORY_LABELS[k as Category]} × ${v}`).join(" + ")} (normalised over tested components).`,
      components: overall.parts.map(({ name, weight, effectiveWeight, score, contribution }) => ({ name, weight, effectiveWeight: Math.round(effectiveWeight * 1000) / 10, score, contribution })),
      partial: overallParts.some((p) => p.score === null) || seoParts.some((p) => p.score === null),
    },
    totals: {
      errors: tested.filter((c) => c.status === "fail").length,
      warnings: tested.filter((c) => c.status === "warning").length,
      passed: tested.filter((c) => c.status === "pass").length,
      notTested: tested.filter((c) => c.status === "not_tested").length,
      critical: tested.filter((c) => c.status === "fail" && c.severity === "critical").length,
      high: tested.filter((c) => c.status === "fail" && c.severity === "high").length,
    },
  };
}

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;
const STATUS_ORDER: Record<CheckStatus, number> = { fail: 0, warning: 1, not_tested: 2, info: 3, pass: 4, not_applicable: 5 };

/** Issues (fail/warning) ordered by severity then status: the "fix first" list. */
export function prioritizedIssues(checks: CheckResult[]): CheckResult[] {
  return checks
    .filter((c) => c.status === "fail" || c.status === "warning")
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || checkPoints(b) - checkPoints(a));
}
