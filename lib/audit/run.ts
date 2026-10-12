import { randomUUID } from "node:crypto";
import { imageSize } from "image-size";
import { parsePage } from "./parse";
import { fetchRobots, type RobotsContext } from "./robots";
import { checkSitemaps, normalizeForCompare } from "./sitemap";
import { analyzeStructuredData } from "./structured-data";
import type { Fetcher } from "./fetcher";
import type { AuditEvent, AuditInput, AuditRecord, CheckResult, ImageRecord, LinkRecord, PerformanceResult, RenderResult, StageId, StageState, StageStatus } from "./types";
import { STAGES } from "./types";
import type { CheckContext } from "./checks/context";
import { technicalChecks } from "./checks/technical";
import { imageChecks } from "./checks/images";
import { analyzeKeyword, contentChecks } from "./checks/content";
import { aeoChecks, aeoSuggestions } from "./checks/aeo";
import { aiCrawlerTable, geoChecks } from "./checks/geo";
import { performanceChecks } from "./checks/performance";
import { mobileChecks } from "./checks/mobile";
import { computeScores } from "../scoring/score";
import { CRAWLER_TOKEN, LIMITS } from "../config";
import { normalizeAndValidateUrl } from "../security/url";
import { notTestedPerformance } from "./pagespeed";

export interface AuditDeps {
  fetcher: Fetcher;
  validate: (url: URL) => Promise<unknown>;
  pageSpeed: (url: string, strategy: "mobile" | "desktop", signal?: AbortSignal) => Promise<PerformanceResult>;
  render: (url: string, signal?: AbortSignal) => Promise<RenderResult>;
  renderingAvailable: boolean;
  pageSpeedConfigured: boolean;
  save: (record: AuditRecord) => Promise<void>;
  now?: () => Date;
}

export class AuditAbortedError extends Error {
  constructor() {
    super("The audit was cancelled.");
    this.name = "AuditAbortedError";
  }
}
export class AuditFailedError extends Error {
  constructor(message: string, readonly stage: StageId) {
    super(message);
    this.name = "AuditFailedError";
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      if (signal?.aborted) return;
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Only a missing DNS record proves a link target is dead; timeouts/resets/proxy refusals do not. */
function provesBroken(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "dns" || code === undefined;
}

const LIMITATIONS = [
  "Single-page audit: duplicate metadata, duplicate content and orphan pages need a multi-page crawl (Phase 2).",
  "Google indexing status is not verified without a Google Search Console connection.",
  "Search volume, keyword difficulty, rankings and backlinks are unavailable: no keyword data provider is connected.",
  "AI visibility (mentions or citations in ChatGPT, Gemini, Perplexity and others) cannot be measured by a technical crawl and is not estimated.",
  "AI crawler results reflect robots.txt rules only, not firewall/CDN behaviour or actual inclusion.",
  "Scores are this application's diagnostic model, not an official Google, ChatGPT or other search engine score.",
];

export async function runAudit(rawInput: AuditInput, deps: AuditDeps, emit: (e: AuditEvent) => void, signal?: AbortSignal): Promise<AuditRecord> {
  const now = deps.now || (() => new Date());
  const createdAt = now().toISOString();
  const stages: StageState[] = STAGES.map((s) => ({ id: s.id, label: s.label, status: "pending" }));
  const set = (id: StageId, status: StageStatus, detail?: string) => {
    const st = stages.find((s) => s.id === id)!;
    st.status = status;
    st.detail = detail;
    emit({ type: "stage", stage: id, status, detail });
  };
  const guard = () => {
    if (signal?.aborted) throw new AuditAbortedError();
  };
  let partial = false;
  const input: AuditInput = { ...rawInput, linksToCheck: Math.max(0, Math.min(LIMITS.maxLinksToCheck, rawInput.linksToCheck ?? LIMITS.defaultLinksToCheck)) };

  // 1. Validate
  set("validate", "running");
  let target: URL;
  try {
    target = normalizeAndValidateUrl(input.url);
    await deps.validate(target);
  } catch (e) {
    set("validate", "failed", (e as Error).message);
    throw new AuditFailedError((e as Error).message, "validate");
  }
  set("validate", "done", target.toString());
  guard();

  // 2. Fetch (robots.txt first when respecting it)
  set("fetch", "running", input.respectRobots ? "Checking robots.txt" : undefined);
  let robots: RobotsContext | null = null;
  if (input.respectRobots) {
    robots = await fetchRobots(target.toString(), deps.fetcher, signal);
    if (robots.summary.allowedForCrawler === false) {
      const msg = `robots.txt disallows ${CRAWLER_TOKEN} (and general crawlers) from this URL. The audit was stopped to respect the site's rules.`;
      set("fetch", "failed", msg);
      throw new AuditFailedError(msg, "fetch");
    }
  }
  guard();
  let res;
  try {
    set("fetch", "running", "Downloading HTML");
    res = await deps.fetcher.fetch(target.toString(), { signal, maxBytes: LIMITS.maxHtmlBytes, timeoutMs: LIMITS.pageTimeoutMs });
  } catch (e) {
    if (signal?.aborted) throw new AuditAbortedError();
    set("fetch", "failed", (e as Error).message);
    throw new AuditFailedError(`Could not fetch the page: ${(e as Error).message}`, "fetch");
  }
  const ctype = res.headers["content-type"] || "";
  if (ctype && !/html|xml/i.test(ctype)) {
    const msg = `The URL returned ${ctype.split(";")[0]}, not an HTML page.`;
    set("fetch", "failed", msg);
    throw new AuditFailedError(msg, "fetch");
  }
  const finalUrl = res.url;
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    // Still audited (the status itself is a finding) but surfaced clearly.
    set("fetch", "done", `HTTP ${res.status}: the site may be blocking automated requests. Results reflect what a crawler receives.`);
  } else {
    set("fetch", "done", `HTTP ${res.status}, ${Math.round(res.body.length / 1024)} KB in ${res.timeMs} ms${res.redirects.length ? `, ${res.redirects.length} redirect(s)` : ""}`);
  }
  if (!robots || new URL(finalUrl).origin !== target.origin) robots = await fetchRobots(finalUrl, deps.fetcher, signal);
  if (input.respectRobots && robots.summary.allowedForCrawler === false) {
    const msg = `robots.txt on ${new URL(finalUrl).origin} disallows ${CRAWLER_TOKEN} from the final URL. The audit was stopped.`;
    set("discover", "failed", msg);
    throw new AuditFailedError(msg, "discover");
  }
  guard();

  // Kick off slow external work in parallel; each stage completes only when its promise does.
  const psiPromise: Promise<PerformanceResult[]> | null = input.runPerformance
    ? (set("performance", "running", "Waiting for PageSpeed Insights (mobile and desktop)"),
      Promise.all([deps.pageSpeed(finalUrl, "mobile", signal), deps.pageSpeed(finalUrl, "desktop", signal)]))
    : null;
  const renderPromise: Promise<RenderResult> | null =
    input.renderJs && deps.renderingAvailable ? (set("mobile", "running", "Rendering in headless Chromium at 3 viewports"), deps.render(finalUrl, signal)) : null;

  // 3. Discover
  set("discover", "running");
  const html = res.body.toString("utf8");
  const parsed = parsePage(html, finalUrl);
  parsed.summary.xRobotsTag = res.headers["x-robots-tag"] || null;
  const sitemap = await checkSitemaps(finalUrl, robots.summary.sitemaps, deps.fetcher, signal);
  const internalCount = parsed.links.filter((l) => l.internal).length;
  set("discover", "done", `${internalCount} internal and ${parsed.links.length - internalCount} external links; ${sitemap.totalUrls} sitemap URL(s) read`);
  guard();

  // 4. Metadata & headings
  set("metadata", "running");
  const sd = analyzeStructuredData(parsed.jsonLd, parsed.microdataTypes);
  set("metadata", "done", `${parsed.summary.titles.length} title(s), ${parsed.summary.headings.length} heading(s), ${sd.jsonLdBlocks} JSON-LD block(s)`);
  guard();

  // 5. Canonical & indexability
  set("indexability", "running");
  let canonicalProbe: CheckContext["canonicalProbe"] = null;
  const canon = parsed.summary.canonical;
  if (canon && /^https?:/i.test(canon)) {
    if (normalizeForCompare(canon) === normalizeForCompare(finalUrl)) {
      canonicalProbe = { url: canon, status: res.status, finalUrl };
    } else {
      try {
        const c = await deps.fetcher.fetch(canon, { method: "HEAD", maxRedirects: 0, timeoutMs: LIMITS.subresourceTimeoutMs, signal });
        canonicalProbe = { url: canon, status: c.status, finalUrl: c.url };
      } catch (e) {
        canonicalProbe = { url: canon, status: null, finalUrl: null, error: (e as Error).message };
      }
    }
  }
  set("indexability", "done", canon ? `Canonical: ${canon}` : "No canonical tag");
  guard();

  // 6. Images & links
  set("assets", "running");
  const internalLinks = parsed.links.filter((l) => l.internal && normalizeForCompare(l.href) !== normalizeForCompare(finalUrl));
  const uniq = (ls: LinkRecord[]) => Array.from(new Map(ls.map((l) => [normalizeForCompare(l.href), l])).values());
  const toCheck = [...uniq(internalLinks).slice(0, input.linksToCheck), ...(input.checkExternalLinks ? uniq(parsed.links.filter((l) => !l.internal)).slice(0, 10) : [])];
  const imagesToProbe = parsed.images.slice(0, LIMITS.maxImagesToProbe);
  const total = toCheck.length + imagesToProbe.length;
  let doneCount = 0;
  const tick = () => {
    doneCount++;
    if (doneCount % 5 === 0 || doneCount === total) set("assets", "running", `Checked ${doneCount} of ${total} links and images`);
  };
  const linksChecked = await mapLimit(toCheck, LIMITS.probeConcurrency, async (l) => {
    const rec: LinkRecord = { ...l };
    try {
      let r = await deps.fetcher.fetch(l.href, { method: "HEAD", timeoutMs: LIMITS.subresourceTimeoutMs, signal });
      if ([403, 405, 501].includes(r.status)) r = await deps.fetcher.fetch(l.href, { maxBytes: 16 * 1024, timeoutMs: LIMITS.subresourceTimeoutMs, signal });
      rec.status = r.status;
      rec.finalUrl = r.url;
    } catch (e) {
      rec.status = null;
      rec.error = (e as Error).message;
      rec.unverified = !provesBroken(e);
    }
    tick();
    return rec;
  }, signal);
  const images: ImageRecord[] = parsed.images.map((i) => ({ ...i }));
  await mapLimit(images.slice(0, LIMITS.maxImagesToProbe), LIMITS.probeConcurrency, async (img) => {
    try {
      const r = await deps.fetcher.fetch(img.src, { range: `bytes=0-${LIMITS.maxImageProbeBytes - 1}`, maxBytes: LIMITS.maxImageProbeBytes, timeoutMs: LIMITS.subresourceTimeoutMs, accept: "image/avif,image/webp,image/*,*/*;q=0.5", signal });
      const range = r.headers["content-range"]?.match(/\/(\d+)$/)?.[1];
      const bytes = range ? Number(range) : r.headers["content-length"] && r.status === 200 && !r.truncated ? Number(r.headers["content-length"]) : r.status === 200 && !r.truncated ? r.body.length : null;
      let width: number | null = null, height: number | null = null, format: string | null = null;
      if (r.status < 400 && r.body.length) {
        try {
          const dim = imageSize(new Uint8Array(r.body));
          width = dim.width ?? null;
          height = dim.height ?? null;
          format = dim.type ?? null;
        } catch {}
      }
      img.probe = { status: r.status, contentType: r.headers["content-type"] || null, bytes, width, height, format };
    } catch (e) {
      img.probe = { status: null, contentType: null, bytes: null, width: null, height: null, format: null, error: (e as Error).message, unverified: !provesBroken(e) };
    }
    tick();
  }, signal);
  guard();
  set("assets", "done", `Checked ${linksChecked.length} link(s) and ${imagesToProbe.length} image(s)`);

  // 7. Mobile (rendered)
  let render: RenderResult;
  if (!input.renderJs) {
    render = { status: "not_tested", error: "JavaScript rendering was disabled for this audit.", viewports: [] };
    set("mobile", "skipped", "Rendering disabled; static viewport checks only");
  } else if (!renderPromise) {
    render = { status: "not_tested", error: "Browser rendering is not configured on this server.", viewports: [] };
    set("mobile", "skipped", "Browser rendering not configured; static viewport checks only");
  } else {
    render = await renderPromise;
    guard();
    if (render.status === "ok") set("mobile", "done", `Rendered at ${render.viewports.map((v) => `${v.width}px`).join(", ")}`);
    else {
      partial = true;
      set("mobile", "failed", render.error);
    }
  }

  // 8. Performance
  let performance: PerformanceResult[];
  if (!psiPromise) {
    performance = [notTestedPerformance("mobile", "Performance tests were disabled for this audit."), notTestedPerformance("desktop", "Performance tests were disabled for this audit.")];
    set("performance", "skipped", "Disabled for this audit");
  } else {
    performance = await psiPromise;
    guard();
    const okCount = performance.filter((p) => p.status === "ok").length;
    if (okCount === 2) set("performance", "done", performance.map((p) => `${p.strategy}: ${p.score}`).join(", "));
    else {
      partial = true;
      set("performance", okCount ? "done" : "failed", performance.map((p) => `${p.strategy}: ${p.status === "ok" ? p.score : p.error}`).join("; "));
    }
  }

  const ctx: CheckContext = {
    input, requestedUrl: target.toString(), url: finalUrl, status: res.status, headers: res.headers, redirects: res.redirects, htmlTruncated: res.truncated,
    parsed, robots, sitemap, sd, canonicalProbe, linksChecked, images, imagesProbed: imagesToProbe.length > 0, render, performance,
  };

  // 9-11. Checks
  set("seo", "running");
  const keyword = analyzeKeyword(ctx);
  const checks: CheckResult[] = [...technicalChecks(ctx), ...imageChecks(ctx), ...contentChecks(ctx, keyword), ...performanceChecks(ctx), ...mobileChecks(ctx)];
  set("seo", "done", `${checks.length} SEO checks evaluated`);
  set("aeo", "running");
  const aeo = aeoChecks(ctx);
  checks.push(...aeo);
  set("aeo", "done", `${aeo.length} AEO checks evaluated`);
  set("geo", "running");
  const geo = geoChecks(ctx);
  checks.push(...geo);
  set("geo", "done", `${geo.length} GEO checks evaluated`);
  guard();

  // 12. Scoring
  set("scoring", "running");
  const scores = computeScores(checks);
  if (scores.overall.partial) partial = true;
  set("scoring", "done", scores.overall.score === null ? "Overall score unavailable" : `Overall ${scores.overall.score}`);

  // 13. Report
  set("report", "running");
  const partialReasons = [
    ...(render.status !== "ok" ? [`Rendered checks: ${render.error}`] : []),
    ...performance.filter((p) => p.status !== "ok").map((p) => `Performance (${p.strategy}): ${p.error}`),
  ];
  const id = randomUUID();
  const record: AuditRecord = {
    id,
    createdAt,
    completedAt: now().toISOString(),
    status: partial ? "partial" : "complete",
    input,
    requestedUrl: target.toString(),
    finalUrl,
    httpStatus: res.status,
    redirects: res.redirects,
    responseTimeMs: res.timeMs,
    htmlBytes: res.body.length,
    htmlTruncated: res.truncated,
    pagesCrawled: 1,
    stages,
    page: parsed.summary,
    robots: robots.summary,
    sitemap,
    images,
    links: {
      internal: internalCount,
      external: parsed.links.length - internalCount,
      nofollow: parsed.links.filter((l) => l.nofollow).length,
      checked: linksChecked.filter(Boolean),
      all: parsed.links.slice(0, 500),
    },
    structuredData: sd,
    keyword,
    aiCrawlers: aiCrawlerTable(ctx),
    performance,
    render,
    checks,
    scores,
    suggestions: aeoSuggestions(ctx),
    partialReasons,
    limitations: [
      ...LIMITATIONS,
      ...partialReasons,
      ...(input.competitorUrls?.length ? ["Competitor URLs were recorded but competitor comparison is planned for Phase 3 and was not run."] : []),
      ...(input.enableAi ? ["AI recommendations were requested but no AI provider is configured; no AI output was generated."] : []),
    ],
    integrations: {
      pagespeed: !input.runPerformance ? "Disabled for this audit" : deps.pageSpeedConfigured ? "Configured (API key)" : "Keyless shared quota",
      searchConsole: "Not connected",
      ai: "Not configured",
      rendering: deps.renderingAvailable ? (input.renderJs ? "Enabled" : "Disabled for this audit") : "Not configured on server",
      keywordData: "Not connected",
    },
  };
  await deps.save(record);
  set("report", "done", "Saved");
  emit({ type: "done", auditId: id, partial });
  return record;
}
