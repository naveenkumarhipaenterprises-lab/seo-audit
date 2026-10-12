/**
 * Central, non-secret application configuration. Values can be overridden with
 * NEXT_PUBLIC_* env vars so the product can be rebranded without code changes.
 */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "SearchScope AI";
export const APP_TAGLINE =
  process.env.NEXT_PUBLIC_APP_TAGLINE || "Understand Your SEO. Improve Your AI Visibility.";

/** Server-only limits. */
export const LIMITS = {
  pageTimeoutMs: 15_000,
  subresourceTimeoutMs: 8_000,
  maxHtmlBytes: 5 * 1024 * 1024,
  maxRobotsBytes: 512 * 1024,
  maxSitemapBytes: 5 * 1024 * 1024,
  maxSitemapsFetched: 4,
  maxImageProbeBytes: 64 * 1024,
  maxRedirects: 5,
  defaultLinksToCheck: 20,
  maxLinksToCheck: 50,
  maxImagesToProbe: 40,
  probeConcurrency: 4,
  maxConcurrentAudits: Number(process.env.MAX_CONCURRENT_AUDITS || 3),
  auditsPerIpPerWindow: Number(process.env.AUDIT_RATE_LIMIT || 6),
  rateWindowMs: 60_000,
  psiTimeoutMs: 60_000,
  renderTimeoutMs: 25_000,
} as const;

export const CRAWLER_TOKEN = "SearchScopeBot";
export const CRAWLER_USER_AGENT =
  process.env.CRAWLER_USER_AGENT ||
  `Mozilla/5.0 (compatible; ${CRAWLER_TOKEN}/0.1; site audit tool)`;
