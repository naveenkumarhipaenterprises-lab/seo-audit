import type { ParsedPage } from "../parse";
import type { RobotsContext } from "../robots";
import type {
  AuditInput, Category, CheckResult, CheckStatus, ImageRecord, LinkRecord, PerformanceResult, RenderResult, Severity,
  SitemapSummary, StructuredDataSummary,
} from "../types";

export interface CheckContext {
  input: AuditInput;
  requestedUrl: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  redirects: { url: string; status: number; location: string }[];
  htmlTruncated: boolean;
  parsed: ParsedPage;
  robots: RobotsContext;
  sitemap: SitemapSummary;
  sd: StructuredDataSummary;
  canonicalProbe: { url: string; status: number | null; finalUrl: string | null; error?: string } | null;
  linksChecked: LinkRecord[];
  images: ImageRecord[];
  imagesProbed: boolean;
  render: RenderResult;
  performance: PerformanceResult[];
}

type Spec = Omit<CheckResult, "evidence" | "limitation" | "measuredScore"> & {
  evidence?: string[];
  limitation?: string;
  measuredScore?: number;
};

export function check(s: Spec): CheckResult {
  return { ...s, evidence: (s.evidence || []).slice(0, 25) };
}

/** Builder bound to a category/group/url so each module stays terse. */
export function builder(category: Category, group: string, url: string) {
  return (
    id: string,
    title: string,
    status: CheckStatus,
    severity: Severity,
    explanation: string,
    recommendation: string,
    detection: string,
    evidence: string[] = [],
    limitation?: string,
  ) => check({ id, category, group, title, status, severity, url, explanation, recommendation, detection, evidence, limitation });
}

export const isArticleLike = (ctx: CheckContext) =>
  ctx.sd.types.some((t) => /Article|BlogPosting|NewsArticle/.test(t)) || (ctx.parsed.summary.openGraph["og:type"] || "") === "article";

export const isHomepage = (url: string) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") === "";
  } catch {
    return false;
  }
};

export const truncate = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
