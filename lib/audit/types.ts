export type CheckStatus = "pass" | "warning" | "fail" | "info" | "not_applicable" | "not_tested";
export type Severity = "critical" | "high" | "medium" | "low";
export type Category = "technical" | "content" | "images" | "aeo" | "geo" | "performance" | "mobile";

export const CATEGORY_LABELS: Record<Category, string> = {
  technical: "Technical & On-Page SEO",
  content: "Keyword & Content",
  images: "Image SEO",
  aeo: "AEO Readiness",
  geo: "GEO Readiness",
  performance: "Performance",
  mobile: "Mobile Usability",
};

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
}

export interface AuditInput {
  url: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  competitorUrls?: string[];
  respectRobots: boolean;
  renderJs: boolean;
  runPerformance: boolean;
  enableAi: boolean;
  linksToCheck: number;
  checkExternalLinks: boolean;
}

export type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface StageState {
  id: StageId;
  label: string;
  status: StageStatus;
  detail?: string;
}

export const STAGES = [
  { id: "validate", label: "Validating website URL" },
  { id: "fetch", label: "Fetching website HTML" },
  { id: "discover", label: "Discovering internal pages" },
  { id: "metadata", label: "Analysing metadata and headings" },
  { id: "indexability", label: "Checking canonical tags and indexability" },
  { id: "assets", label: "Scanning images and links" },
  { id: "mobile", label: "Testing mobile responsiveness" },
  { id: "performance", label: "Measuring website performance" },
  { id: "seo", label: "Analysing SEO signals" },
  { id: "aeo", label: "Analysing AEO readiness" },
  { id: "geo", label: "Analysing GEO readiness" },
  { id: "scoring", label: "Calculating scores" },
  { id: "report", label: "Generating the final report" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];

export type AuditEvent =
  | { type: "stage"; stage: StageId; status: StageStatus; detail?: string }
  | { type: "done"; auditId: string; partial: boolean }
  | { type: "error"; message: string; stage?: StageId };

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
  fetchedAt?: string;
  lighthouseVersion?: string;
  score: number | null;
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
    components: { name: "SEO" | "AEO" | "GEO"; weight: number; effectiveWeight: number; score: number | null; contribution: number | null }[];
    partial: boolean;
  };
  totals: { errors: number; warnings: number; passed: number; notTested: number; critical: number; high: number };
}

export interface AuditRecord {
  id: string;
  createdAt: string;
  completedAt: string;
  status: "complete" | "partial" | "failed";
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
  integrations: { pagespeed: string; searchConsole: string; ai: string; rendering: string; keywordData: string };
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
