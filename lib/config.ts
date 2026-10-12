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
  /** Full Site crawl bounds. */
  maxCrawlPages: 100,
  defaultCrawlPages: 25,
  maxCrawlDepth: 5,
  defaultCrawlDepth: 2,
  crawlConcurrency: 3,
  /** Wall-clock budget for the crawl stage; the crawl stops (partial inventory) when it is reached. */
  crawlTimeBudgetMs: Number(process.env.CRAWL_TIME_BUDGET_MS || 180_000),
  maxSitemapSeeds: 200,
  maxSitemapUrlsKept: 5000,
  maxCompetitors: 3,
  /** Finished jobs stay queryable this long so a refreshed page can still show the outcome. */
  jobRetentionMs: 30 * 60_000,
  psiCacheMs: 10 * 60_000,
} as const;

/** Bumped when the record shape or engine behaviour changes. */
export const ENGINE_VERSION = "2.0.0";

export const CRAWLER_TOKEN = "SearchScopeBot";
export const CRAWLER_USER_AGENT =
  process.env.CRAWLER_USER_AGENT ||
  `Mozilla/5.0 (compatible; ${CRAWLER_TOKEN}/0.1; site audit tool)`;
