import type { Category, Severity } from "../audit/types";

/** Bump whenever weights or check definitions change; stored with every audit. */
export const METHODOLOGY_VERSION = "2026.10-v2";

/** Points available per check, by severity (initial configurable model from the product brief). A failing check forfeits all of them. */
export const SEVERITY_WEIGHTS: Record<Severity, number> = { critical: 10, high: 5, medium: 2, low: 1 };

/** Fraction of points earned per status. "info", "not_applicable" and "not_tested" are excluded from the denominator. */
export const STATUS_CREDIT = { pass: 1, warning: 0.5, fail: 0 } as const;

/** Optional per-check overrides (check id -> points). */
export const CHECK_WEIGHT_OVERRIDES: Record<string, number> = {};

/**
 * The SEO score combines these categories. Each check belongs to exactly one category and
 * each category feeds exactly one part of the overall score, so nothing is counted twice.
 */
export const SEO_COMPONENT_WEIGHTS: Partial<Record<Category, number>> = {
  technical: 30,
  onpage: 15,
  content: 15,
  images: 10,
  performance: 20,
  mobile: 10,
};

/** Overall audit health. Accessibility and security are site-health signals, weighted lightly. */
export const OVERALL_WEIGHTS = { SEO: 45, AEO: 20, GEO: 20, Accessibility: 10, Security: 5 } as const;
export type OverallComponent = keyof typeof OVERALL_WEIGHTS;

export const SCORE_NOTICE =
  "SEO, AEO and GEO scores are calculated from measurable website checks and this tool’s assessment criteria. Search rankings and AI visibility may vary. These are not official Google scores, and improving them does not guarantee higher rankings, more traffic or AI citations.";
