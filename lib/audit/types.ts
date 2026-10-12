export type CheckStatus = "pass" | "warning" | "fail" | "info" | "not_applicable" | "not_tested";
export type Severity = "critical" | "high" | "medium" | "low";
export type Category = "technical" | "onpage" | "content" | "images" | "aeo" | "geo" | "performance" | "mobile" | "accessibility" | "security";

export const CATEGORY_LABELS: Record<Category, string> = {
  technical: "Technical SEO",
  onpage: "On-Page SEO",
  content: "Keywords & Content",
  images: "Image SEO",
  aeo: "AEO Readiness",
  geo: "GEO Readiness",
  performance: "Performance",
  mobile: "Mobile Usability",
  accessibility: "Accessibility & HTML",
  security: "Security Headers",
};

/**
 * Where a finding comes from:
 * - observed: directly measured from what the site returned (HTTP, HTML, headers, robots.txt, sitemaps).
 * - external: a metric retrieved from a third-party API (PageSpeed Insights, Search Console).
 * - assessment: this application's own judgement built on observed data (AEO/GEO readiness, readability, alt quality).
 */
export type FindingSource = "observed" | "external" | "assessment";
export const SOURCE_LABELS: Record<FindingSource, string> = {
  observed: "Observed",
  external: "External data",
  assessment: "Tool assessment",
};

export type AuditMode = "quick" | "full";
export type IssueState = "open" | "ignored" | "not_applicable";

export interface CheckResult {
  id: string;
  category: Category;
  /** Sub-group used for display, e.g. "Metadata", "Headings", "Indexability". */
  group: string;
  title: string;
  status: CheckStatus;
  severity: Severity;
  url: string;
  evidence: string[];
  explanation: string;
  recommendation: string;
  detection: string;
  limitation?: string;
  /** Measured 0-100 score (only for Lighthouse performance checks). */
  measuredScore?: number;
  /** Provenance of the finding. Older stored audits may lack it; see sourceOf(). */
  source?: FindingSource;
  /** Every URL the finding applies to (site-level checks in Full Site mode). */
  affectedUrls?: string[];
  /** ISO time the check was evaluated. */
  detectedAt?: string;
}

export interface AuditInput {
  url: string;
  mode: AuditMode;
  /** Full Site mode: maximum HTML pages fetched, including the start page. */
  maxPages: number;
  /** Full Site mode: maximum link depth from the start page (0 = start page only). */
  maxDepth: number;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  competitorUrls?: string[];
  businessName?: string;
  businessLocation?: string;
  businessType?: string;
  respectRobots: boolean;
  renderJs: boolean;
  runPerformance: boolean;
  performanceStrategy: "mobile" | "desktop" | "both";
  useSearchConsole: boolean;
  /** Kept for compatibility with stored MVP audits; no AI provider is integrated. */
  enableAi?: boolean;
  linksToCheck: number;
  checkExternalLinks: boolean;
}

/** "pending"/"done" appear only in audits stored by the MVP; use normalizeStageStatus(). */
export type StageStatus = "queued" | "running" | "completed" | "skipped" | "failed";

export interface StageState {
  id: StageId;
  label: string;
  status: StageStatus;
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}

export const STAGES = [
  { id: "validate", label: "Validating URL", modes: ["quick", "full"] },
  { id: "connect", label: "Connecting to website", modes: ["quick", "full"] },
  { id: "fetch", label: "Fetching HTML", modes: ["quick", "full"] },
  { id: "discover", label: "Discovering sitemap and robots.txt", modes: ["quick", "full"] },
  { id: "crawl", label: "Crawling internal pages", modes: ["full"] },
  { id: "technical", label: "Analyzing technical SEO", modes: ["quick", "full"] },
  { id: "content", label: "Checking metadata and content", modes: ["quick", "full"] },
  { id: "assets", label: "Analyzing images and internal links", modes: ["quick", "full"] },
  { id: "structured", label: "Validating structured data", modes: ["quick", "full"] },
  { id: "aeo", label: "Evaluating AEO", modes: ["quick", "full"] },
  { id: "geo", label: "Evaluating GEO", modes: ["quick", "full"] },
  { id: "performance", label: "Running performance analysis", modes: ["quick", "full"] },
  { id: "scoring", label: "Calculating scores", modes: ["quick", "full"] },
  { id: "report", label: "Preparing the report", modes: ["quick", "full"] },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export const stagesForMode = (mode: AuditMode) => STAGES.filter((s) => (s.modes as readonly string[]).includes(mode));

/** Sub-tasks that run inside a stage and can be slow (shown so users see which external check is still running). */
export interface TaskState {
  id: string;
  stage: StageId;
  label: string;
  status: StageStatus;
  detail?: string;
}

export interface CrawlProgress {
  discovered: number;
  processed: number;
  failed: number;
  limit: number;
}

export type AuditEvent =
  | { type: "stage"; stage: StageId; status: StageStatus; detail?: string }
  | { type: "task"; task: TaskState }
  | { type: "pages"; pages: CrawlProgress }
  | { type: "done"; auditId: string; status: AuditRecordStatus }
  | { type: "error"; message: string; stage?: StageId };

export type AuditRecordStatus = "completed" | "completed_with_warnings" | "partial";
export type AuditFinalStatus = AuditRecordStatus | "failed" | "cancelled";
export const FINAL_STATUS_LABELS: Record<AuditFinalStatus, string> = {
  completed: "Completed",
  completed_with_warnings: "Completed with warnings",
  partial: "Partially completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export interface ImageRecord {
  src: string;
  sourcePage: string;
  alt: string | null;
  altState: "present" | "empty" | "missing";
  decorativeHint: boolean;
  widthAttr: string | null;
  heightAttr: string | null;
  loading: string | null;
  hasSrcset: boolean;
  inPicture: boolean;
  probe?: {
    status: number | null;
    contentType: string | null;
    bytes: number | null;
    width: number | null;
    height: number | null;
    format: string | null;
    error?: string;
    /** True when the request failed for a reason that does not prove the image is broken (timeout, reset, proxy). */
    unverified?: boolean;
  };
}

export interface LinkRecord {
  href: string;
  text: string;
  rel: string;
  internal: boolean;
  nofollow: boolean;
  status?: number | null;
  finalUrl?: string;
  error?: string;
  unverified?: boolean;
}

export interface PerformanceResult {
  strategy: "mobile" | "desktop";
  status: "ok" | "error" | "not_tested";
  error?: string;
  /** True when the error was a quota/rate limit (retry later or add an API key). */
  quota?: boolean;
  fetchedAt?: string;
  /** Set when this result was served from the short-lived in-memory cache. */
  cached?: boolean;
  lighthouseVersion?: string;
  score: number | null;
  /** Lighthouse category scores (0-100) exactly as returned; missing categories are null. */
  categories?: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null };
  lab: Record<string, { value: number | null; display: string | null; score: number | null }>;
  field: {
    source: "url" | "origin" | "none";
    overall: string | null;
    metrics: Record<string, { p75: number | null; category: string | null }>;
  };
  opportunities: { id: string; title: string; display: string | null; savingsMs: number | null }[];
}

export interface RenderResult {
  status: "ok" | "error" | "not_tested";
  error?: string;
  renderedWordCount?: number;
  renderedTitle?: string;
  renderedH1Count?: number;
  blockedRequests?: number;
  viewports: {
    name: string;
    width: number;
    height: number;
    scrollWidth: number;
    horizontalOverflow: boolean;
    clippedElements: number;
    smallTextRatio: number;
    smallTapTargets: number;
    tapTargetsChecked: number;
    imagesWiderThanViewport: number;
  }[];
}

export interface ScoreBreakdown {
  category: Category;
  label: string;
  score: number | null;
  earned: number;
  possible: number;
  counts: Record<CheckStatus, number>;
}

export interface Scores {
  methodologyVersion: string;
  categories: Record<Category, ScoreBreakdown>;
  seo: { score: number | null; components: { category: Category; weight: number; score: number | null; contribution: number | null }[] };
  overall: {
    score: number | null;
    formula: string;
    components: { name: "SEO" | "AEO" | "GEO" | "Accessibility" | "Security"; weight: number; effectiveWeight: number; score: number | null; contribution: number | null }[];
    partial: boolean;
  };
  /** tested = pass + warning + fail. notApplicable/info are present on v2 audits only. */
  totals: { tested?: number; notApplicable?: number; info?: number; errors: number; warnings: number; passed: number; notTested: number; critical: number; high: number };
}

export interface AuditRecord {
  id: string;
  /** Audit engine / record schema version. */
  engineVersion?: string;
  createdAt: string;
  completedAt: string;
  status: AuditRecordStatus;
  /** Opaque owner id (hash of the browser's owner cookie). Absent on MVP-era audits. */
  ownerId?: string;
  input: AuditInput;
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  redirects: { url: string; status: number; location: string }[];
  responseTimeMs: number | null;
  htmlBytes: number;
  htmlTruncated: boolean;
  pagesCrawled: number;
  stages: StageState[];
  tasks?: TaskState[];
  /** Full Site mode crawl summary and page inventory (start page only in Quick mode). */
  crawl?: CrawlSummary;
  pages?: PageInventoryItem[];
  security?: SecuritySummary;
  competitors?: CompetitorSnapshot[];
  /** The audited page scored with the same reduced method as competitors, for a like-for-like comparison. */
  siteSnapshot?: CompetitorSnapshot;
  searchConsole?: SearchConsoleResult;
  /** User-set state per check id (Open is the default). Does not change scores. */
  issueStates?: Record<string, IssueState>;
  /** Non-fatal problems that make the status "completed with warnings". */
  warnings?: string[];
  page: PageSummary | null;
  robots: RobotsSummary;
  sitemap: SitemapSummary;
  images: ImageRecord[];
  links: { internal: number; external: number; nofollow: number; checked: LinkRecord[]; all: LinkRecord[] };
  structuredData: StructuredDataSummary;
  keyword: KeywordSummary | null;
  aiCrawlers: { agent: string; operator: string; purpose: string; allowed: boolean | null; hasGroup: boolean }[];
  performance: PerformanceResult[];
  render: RenderResult;
  checks: CheckResult[];
  scores: Scores;
  suggestions: { questions: string[]; answerBlocks: string[]; note: string };
  limitations: string[];
  /** Audit-specific reasons the report is partial (subset of limitations). */
  partialReasons: string[];
  integrations: { pagespeed: string; searchConsole: string; ai: string; rendering: string; keywordData: string; aiVisibility?: string };
}

export interface PageInventoryItem {
  url: string;
  finalUrl: string;
  status: number | null;
  depth: number;
  foundVia: "start" | "link" | "sitemap";
  contentType: string | null;
  responseMs: number | null;
  redirects: number;
  title: string | null;
  description: string | null;
  h1: string | null;
  h1Count: number;
  canonical: string | null;
  noindex: boolean;
  /** Indexability signals only (status, noindex, canonical); not actual index status. */
  indexable: boolean | null;
  wordCount: number;
  inlinks: number;
  internalLinksOut: number;
  images: number;
  imagesMissingAlt: number;
  lang: string | null;
  issues: string[];
  error?: string;
  /** Fingerprint of the normalised main text, used for duplicate detection. */
  contentHash?: string;
}

export interface CrawlSummary {
  enabled: boolean;
  maxPages: number;
  maxDepth: number;
  discovered: number;
  processed: number;
  failed: number;
  skippedRobots: number;
  skippedOther: number;
  stopReason: "complete" | "page_limit" | "time_budget" | "cancelled" | "not_run";
  sitemapUrlsUsed: number;
  durationMs: number;
}

export interface SecuritySummary {
  headers: Record<string, string | null>;
  httpRedirectsToHttps: boolean | null;
  httpCheckError?: string;
  /** True when plain HTTP (port 80) refused the connection, i.e. no insecure version is served. */
  httpRefused?: boolean;
  insecureCookies: string[];
}

export interface CompetitorSnapshot {
  url: string;
  finalUrl: string | null;
  fetchedAt: string;
  status: "ok" | "error" | "blocked";
  error?: string;
  httpStatus: number | null;
  responseTimeMs: number | null;
  title: string | null;
  metaDescription: boolean;
  h1Count: number;
  wordCount: number;
  schemaTypes: string[];
  imagesMissingAlt: number;
  images: number;
  https: boolean;
  scores: Partial<Record<Category, number | null>>;
  passed: number;
  failed: number;
}

export interface SearchConsoleResult {
  status: "not_configured" | "not_connected" | "no_matching_property" | "ok" | "error";
  message: string;
  property?: string;
  retrievedAt?: string;
  dateRange?: { start: string; end: string };
  totals?: { clicks: number; impressions: number; ctr: number; position: number };
  pageTotals?: { clicks: number; impressions: number; ctr: number; position: number } | null;
  topQueries?: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
  inspection?: { verdict: string | null; coverageState: string | null; indexingState: string | null; lastCrawlTime: string | null; googleCanonical: string | null; robotsTxtState: string | null; error?: string } | null;
  limitations: string[];
}

export interface PageSummary {
  title: string | null;
  titles: string[];
  metaDescription: string | null;
  metaDescriptions: string[];
  robotsMeta: string[];
  xRobotsTag: string | null;
  canonical: string | null;
  canonicals: string[];
  lang: string | null;
  charset: string | null;
  viewport: string | null;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  headings: { level: number; text: string }[];
  wordCount: number;
  mainWordCount: number;
  hreflang: { lang: string; href: string }[];
}

export interface RobotsSummary {
  status: "ok" | "missing" | "error" | "not_tested";
  url: string;
  httpStatus: number | null;
  allowedForCrawler: boolean | null;
  allowedForGooglebot: boolean | null;
  sitemaps: string[];
  error?: string;
  excerpt?: string;
}

export interface SitemapSummary {
  status: "found" | "not_found" | "error" | "not_tested";
  checked: { url: string; httpStatus: number | null; type: "urlset" | "sitemapindex" | "invalid" | "error"; urlCount: number; error?: string }[];
  totalUrls: number;
  includesAuditedUrl: boolean | null;
  truncated: boolean;
  /** URLs read from the sitemaps (capped). Used for crawl seeding and orphan candidates; not persisted in full. */
  urls?: string[];
}

export interface StructuredDataSummary {
  jsonLdBlocks: number;
  invalidBlocks: { index: number; error: string; snippet: string }[];
  types: string[];
  microdataTypes: string[];
  issues: { type: string; message: string }[];
  items: { type: string; properties: string[] }[];
}

export interface KeywordSummary {
  primary: string;
  secondary: string[];
  placements: { location: string; found: boolean; detail?: string }[];
  occurrences: number;
  density: number;
  secondaryResults: { keyword: string; inBody: boolean; inHeadings: boolean; occurrences: number }[];
  unavailable: string[];
}
