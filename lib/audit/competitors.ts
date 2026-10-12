import { parsePage, type ParsedPage } from "./parse";
import { fetchRobots, type RobotsContext } from "./robots";
import { analyzeStructuredData } from "./structured-data";
import type { Fetcher } from "./fetcher";
import type { CheckContext } from "./checks/context";
import { technicalChecks } from "./checks/technical";
import { imageChecks } from "./checks/images";
import { analyzeKeyword, contentChecks } from "./checks/content";
import { aeoChecks } from "./checks/aeo";
import { geoChecks } from "./checks/geo";
import { accessibilityChecks } from "./checks/accessibility";
import { securityChecks } from "./checks/security";
import { computeScores } from "../scoring/score";
import { CRAWLER_TOKEN, LIMITS } from "../config";
import { normalizeAndValidateUrl } from "../security/url";
import type { AuditInput, CompetitorSnapshot } from "./types";
import { SNAPSHOT_CATEGORIES } from "./snapshot-categories";

export { SNAPSHOT_CATEGORIES };

const NO_SITEMAP = { status: "not_tested" as const, checked: [], totalUrls: 0, includesAuditedUrl: null, truncated: false };

/**
 * Scores one already-fetched page with the same check modules as the main audit, but
 * without link/image probes, rendering, PageSpeed or sitemaps, so the main site and its
 * competitors are compared on identical, actually collected inputs.
 */
export function snapshotFromPage(args: {
  url: string; finalUrl: string; status: number; headers: Record<string, string>; responseMs: number; parsed: ParsedPage; robots: RobotsContext; input: AuditInput; fetchedAt: string;
}): CompetitorSnapshot {
  const { parsed } = args;
  const sd = analyzeStructuredData(parsed.jsonLd, parsed.microdataTypes);
  const ctx: CheckContext = {
    input: { ...args.input, checkExternalLinks: false, businessName: "", businessLocation: "", businessType: "" },
    requestedUrl: args.url, url: args.finalUrl, status: args.status, headers: args.headers, redirects: [], htmlTruncated: false,
    parsed, robots: args.robots, sitemap: NO_SITEMAP, sd, canonicalProbe: null, linksChecked: [], images: parsed.images, imagesProbed: false,
    render: { status: "not_tested", viewports: [] }, performance: [],
  };
  const checks = [...technicalChecks(ctx), ...imageChecks(ctx), ...contentChecks(ctx, analyzeKeyword(ctx)), ...aeoChecks(ctx), ...geoChecks(ctx), ...accessibilityChecks(ctx), ...securityChecks(ctx)];
  const scores = computeScores(checks);
  const out: CompetitorSnapshot["scores"] = {};
  for (const c of SNAPSHOT_CATEGORIES) out[c] = scores.categories[c].score;
  return {
    url: args.url,
    finalUrl: args.finalUrl,
    fetchedAt: args.fetchedAt,
    status: "ok",
    httpStatus: args.status,
    responseTimeMs: args.responseMs,
    title: parsed.summary.title,
    metaDescription: Boolean(parsed.summary.metaDescription),
    h1Count: parsed.summary.headings.filter((h) => h.level === 1).length,
    wordCount: parsed.summary.mainWordCount,
    schemaTypes: sd.types.slice(0, 12),
    imagesMissingAlt: parsed.images.filter((i) => i.altState === "missing").length,
    images: parsed.images.length,
    https: args.finalUrl.startsWith("https:"),
    scores: out,
    passed: checks.filter((c) => c.status === "pass").length,
    failed: checks.filter((c) => c.status === "fail").length,
  };
}

export async function fetchCompetitor(rawUrl: string, input: AuditInput, deps: { fetcher: Fetcher; validate: (u: URL) => Promise<unknown> }, signal?: AbortSignal): Promise<CompetitorSnapshot> {
  const fetchedAt = new Date().toISOString();
  const fail = (status: CompetitorSnapshot["status"], error: string, url = rawUrl): CompetitorSnapshot => ({
    url, finalUrl: null, fetchedAt, status, error, httpStatus: null, responseTimeMs: null, title: null, metaDescription: false, h1Count: 0, wordCount: 0,
    schemaTypes: [], imagesMissingAlt: 0, images: 0, https: false, scores: {}, passed: 0, failed: 0,
  });
  let target: URL;
  try {
    target = normalizeAndValidateUrl(rawUrl);
    await deps.validate(target);
  } catch (e) {
    return fail("blocked", (e as Error).message);
  }
  try {
    const robots = await fetchRobots(target.toString(), deps.fetcher, signal);
    if (input.respectRobots && robots.isAllowed(target.toString(), CRAWLER_TOKEN) === false) return fail("blocked", `robots.txt disallows ${CRAWLER_TOKEN}; the competitor page was not fetched.`, target.toString());
    const res = await deps.fetcher.fetch(target.toString(), { signal, maxBytes: LIMITS.maxHtmlBytes, timeoutMs: LIMITS.pageTimeoutMs });
    const ctype = res.headers["content-type"] || "";
    if (ctype && !/html/i.test(ctype)) return fail("error", `Returned ${ctype.split(";")[0]}, not HTML.`, target.toString());
    const parsed = parsePage(res.body.toString("utf8"), res.url);
    parsed.summary.xRobotsTag = res.headers["x-robots-tag"] || null;
    return snapshotFromPage({ url: target.toString(), finalUrl: res.url, status: res.status, headers: res.headers, responseMs: res.timeMs, parsed, robots, input, fetchedAt });
  } catch (e) {
    if (signal?.aborted) throw e;
    return fail("error", (e as Error).message, target.toString());
  }
}
