import type { Category, Severity } from "../audit/types";

/** Bump whenever weights or check definitions change; stored with every audit. */
export const METHODOLOGY_VERSION = "2026.10-mvp.1";

/** Points available per check, by severity. A failing check forfeits all of them. */
export const SEVERITY_WEIGHTS: Record<Severity, number> = { critical: 10, high: 6, medium: 3, low: 1 };

/** Fraction of points earned per status. "info", "not_applicable" and "not_tested" are excluded from the denominator. */
export const STATUS_CREDIT = { pass: 1, warning: 0.5, fail: 0 } as const;

/** Optional per-check overrides (check id -> points). */
export const CHECK_WEIGHT_OVERRIDES: Record<string, number> = {};

/**
 * The SEO score combines these categories. Performance is used only here (never also in
 * AEO/GEO), and each check belongs to exactly one category, so nothing is counted twice.
 */
export const SEO_COMPONENT_WEIGHTS: Partial<Record<Category, number>> = {
  technical: 40,
  content: 15,
  images: 10,
  performance: 20,
  mobile: 15,
};

export const OVERALL_WEIGHTS = { SEO: 50, AEO: 25, GEO: 25 } as const;
