import { randomUUID } from "node:crypto";
import { imageSize } from "image-size";
import { parsePage } from "./parse";
import { fetchRobots, type RobotsContext } from "./robots";
import { checkSitemaps, normalizeForCompare } from "./sitemap";
import { analyzeStructuredData } from "./structured-data";
import { crawlSite, inventoryItem, type CrawlResult } from "./crawler";
import { fetchCompetitor, snapshotFromPage } from "./competitors";
import type { Fetcher } from "./fetcher";
import type {
  AuditEvent, AuditInput, AuditRecord, AuditRecordStatus, CheckResult, CompetitorSnapshot, CrawlSummary, ImageRecord, LinkRecord,
  PageInventoryItem, PerformanceResult, RenderResult, SearchConsoleResult, SecuritySummary, StageId, StageState, StageStatus, StructuredDataSummary, TaskState,
} from "./types";
import { stagesForMode } from "./types";
import type { CheckContext } from "./checks/context";
import { technicalChecks } from "./checks/technical";
import { imageChecks } from "./checks/images";
import { analyzeKeyword, contentChecks } from "./checks/content";
import { aeoChecks, aeoSuggestions } from "./checks/aeo";
import { aiCrawlerTable, geoChecks } from "./checks/geo";
import { performanceChecks } from "./checks/performance";
import { mobileChecks } from "./checks/mobile";
import { accessibilityChecks, lighthouseAccessibilityCheck } from "./checks/accessibility";
import { insecureCookies, securityChecks } from "./checks/security";
import { anchorCheck, siteChecks } from "./checks/site";
import { sourceOf } from "./record-utils";
import { computeScores } from "../scoring/score";
import { CRAWLER_TOKEN, ENGINE_VERSION, LIMITS } from "../config";
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
  /** Optional Search Console lookup; absent when the integration is not configured. */
  searchConsole?: (owner: string | null, url: string, signal?: AbortSignal) => Promise<SearchConsoleResult>;
  now?: () => Date;
  /** Injectable sleep for crawl retry backoff. */
  sleep?: (ms: number) => Promise<void>;
  crawlBudgetMs?: number;
}

export interface AuditOptions {
  id?: string;
  ownerId?: string | null;
}

export class AuditAbortedError extends Error {
  constructor(readonly stage?: StageId) {
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

const BASE_LIMITATIONS = [
  "Google indexing status is not verified unless Google Search Console is connected and a verified property covers the URL.",
  "Search volume, keyword difficulty, rankings and backlinks are unavailable: no keyword data provider is connected. Keyword analysis is on-page only.",
  "AI visibility (mentions or citations in ChatGPT, Gemini, Perplexity and others) cannot be measured by a website crawl and is not estimated. GEO and AEO are readiness assessments.",
  "AI crawler results reflect robots.txt rules only, not firewall/CDN behaviour or actual inclusion.",
  "Scores are this application's diagnostic model, not an official Google, ChatGPT or other search engine score.",
  "Security checks cover a limited set of public HTTP signals and are not a security assessment.",
];

const SITE_REPLACED = new Set(["duplicate-metadata-sitewide", "duplicate-content", "orphan-pages", "broken-internal-links"]);
const ONPAGE_GROUPS = new Set(["Metadata", "Headings"]);

export async function runAudit(rawInput: AuditInput, deps: AuditDeps, emit: (e: AuditEvent) => void, signal?: AbortSignal, opts: AuditOptions = {}): Promise<AuditRecord> {
  const now = deps.now || (() => new Date());
  const createdAt = now().toISOString();
  const input: AuditInput = {
    ...rawInput,
    mode: rawInput.mode === "full" ? "full" : "quick",
    maxPages: Math.max(2, Math.min(LIMITS.maxCrawlPages, rawInput.maxPages || LIMITS.defaultCrawlPages)),
    maxDepth: Math.max(1, Math.min(LIMITS.maxCrawlDepth, rawInput.maxDepth || LIMITS.defaultCrawlDepth)),
    performanceStrategy: rawInput.performanceStrategy || "both",
    useSearchConsole: Boolean(rawInput.useSearchConsole),
    linksToCheck: Math.max(0, Math.min(LIMITS.maxLinksToCheck, rawInput.linksToCheck ?? LIMITS.defaultLinksToCheck)),
  };
  const full = input.mode === "full";
  const stages: StageState[] = stagesForMode(input.mode).map((s) => ({ id: s.id, label: s.label, status: "queued" }));
  const tasks: TaskState[] = [];
  let current: StageId = "validate";
  const set = (id: StageId, status: StageStatus, detail?: string) => {
    const st = stages.find((s) => s.id === id);
    if (!st) return;
    if (status === "running") {
      current = id;
      st.startedAt ??= now().toISOString();
    } else if (status !== "queued") st.finishedAt = now().toISOString();
    st.status = status;
    st.detail = detail;
    emit({ type: "stage", stage: id, status, detail });
  };
  const task = (id: string, stage: StageId, label: string, status: StageStatus, detail?: string) => {
    let t = tasks.find((x) => x.id === id);
    if (!t) tasks.push((t = { id, stage, label, status }));
    t.status = status;
    t.detail = detail;
    emit({ type: "task", task: { ...t } });
  };
  const guard = () => {
    if (signal?.aborted) throw new AuditAbortedError(current);
  };
  const warnings: string[] = [];
  const partialReasons: string[] = [];

  // 1. Validate
  set("validate", "running", "Checking the URL and resolving DNS");
  let target: URL;
  try {
    target = normalizeAndValidateUrl(input.url);
    await deps.validate(target);
  } catch (e) {
    set("validate", "failed", (e as Error).message);
    throw new AuditFailedError((e as Error).message, "validate");
  }
  set("validate", "completed", target.toString());
  guard();

  // 2. Connect: robots.txt is the first request to the site (and decides whether we may continue).
  set("connect", "running", `Requesting ${target.origin}/robots.txt`);
  let robots: RobotsContext = await fetchRobots(target.toString(), deps.fetcher, signal);
  guard();
  if (input.respectRobots && robots.summary.allowedForCrawler === false) {
    const msg = `robots.txt disallows ${CRAWLER_TOKEN} (and general crawlers) from this URL. The audit was stopped to respect the site's rules.`;
    set("connect", "failed", msg);
    throw new AuditFailedError(msg, "connect");
  }
  set("connect", "completed", robots.summary.status === "ok" ? `Connected; robots.txt HTTP ${robots.summary.httpStatus}` : robots.summary.status === "missing" ? `Connected; no robots.txt (HTTP ${robots.summary.httpStatus})` : `robots.txt could not be read${robots.summary.error ? `: ${robots.summary.error}` : ""}`);

  // 3. Fetch HTML
  set("fetch", "running", "Downloading HTML");
  let res;
  try {
    res = await deps.fetcher.fetch(target.toString(), { signal, maxBytes: LIMITS.maxHtmlBytes, timeoutMs: LIMITS.pageTimeoutMs });
  } catch (e) {
    if (signal?.aborted) throw new AuditAbortedError("fetch");
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
    warnings.push(`The site answered HTTP ${res.status}; it may be blocking automated requests. Results reflect what a crawler receives.`);
    set("fetch", "completed", `HTTP ${res.status}: the site may be blocking automated requests`);
  } else {
    set("fetch", "completed", `HTTP ${res.status}, ${Math.round(res.body.length / 1024)} KB in ${res.timeMs} ms${res.redirects.length ? `, ${res.redirects.length} redirect(s)` : ""}`);
  }
  guard();

  // Slow external work starts now and runs alongside the other stages; the performance stage
  // only completes when these promises settle.
  const strategies: ("mobile" | "desktop")[] = input.performanceStrategy === "both" ? ["mobile", "desktop"] : [input.performanceStrategy];
  let psiPromise: Promise<PerformanceResult[]> | null = null;
  let renderPromise: Promise<RenderResult> | null = null;
  if (input.runPerformance) {
    set("performance", "running", "Waiting for PageSpeed Insights");
    psiPromise = Promise.all(strategies.map(async (s) => {
      task(`psi-${s}`, "performance", `PageSpeed Insights (${s})`, "running", "Google is loading the page");
      const r = await deps.pageSpeed(finalUrl, s, signal);
      task(`psi-${s}`, "performance", `PageSpeed Insights (${s})`, r.status === "ok" ? "completed" : "failed", r.status === "ok" ? `Score ${r.score}${r.cached ? " (cached result)" : ""}` : r.error);
      return r;
    }));
  }
  if (input.renderJs && deps.renderingAvailable) {
    if (!psiPromise) set("performance", "running", "Rendering the page");
    task("render", "performance", "Mobile rendering (headless Chromium)", "running", "375, 768 and 1366 px viewports");
    renderPromise = deps.render(finalUrl, signal).then((r) => {
      task("render", "performance", "Mobile rendering (headless Chromium)", r.status === "ok" ? "completed" : "failed", r.status === "ok" ? `Rendered at ${r.viewports.map((v) => `${v.width}px`).join(", ")}` : r.error);
      return r;
    });
  } else {
    task("render", "performance", "Mobile rendering (headless Chromium)", "skipped", input.renderJs ? "Browser rendering is not configured on this server" : "Disabled for this audit");
  }
  const gscPromise: Promise<SearchConsoleResult> | null = input.useSearchConsole && deps.searchConsole
    ? (task("gsc", "technical", "Google Search Console", "running", "Requesting property data"), deps.searchConsole(opts.ownerId ?? null, finalUrl, signal).then((g) => {
        task("gsc", "technical", "Google Search Console", g.status === "ok" ? "completed" : g.status === "error" ? "failed" : "skipped", g.message);
        return g;
      }))
    : null;

  // 4. Discover robots.txt and sitemaps
  set("discover", "running", "Reading robots.txt and sitemaps");
  if (new URL(finalUrl).origin !== target.origin) robots = await fetchRobots(finalUrl, deps.fetcher, signal);
  if (input.respectRobots && robots.summary.allowedForCrawler === false) {
    const msg = `robots.txt on ${new URL(finalUrl).origin} disallows ${CRAWLER_TOKEN} from the final URL. The audit was stopped.`;
    set("discover", "failed", msg);
    throw new AuditFailedError(msg, "discover");
  }
  const html = res.body.toString("utf8");
  const parsed = parsePage(html, finalUrl);
  parsed.summary.xRobotsTag = res.headers["x-robots-tag"] || null;
  const sitemap = await checkSitemaps(finalUrl, robots.summary.sitemaps, deps.fetcher, signal);
  guard();
  if (robots.summary.status === "error") warnings.push(`robots.txt could not be read (${robots.summary.error || "error"}).`);
  if (sitemap.status === "error") warnings.push("The XML sitemap could not be read or parsed.");
  set("discover", "completed", `robots.txt: ${robots.summary.status}; sitemap: ${sitemap.status === "found" ? `${sitemap.totalUrls} URL(s) in ${sitemap.checked.length} file(s)` : sitemap.status.replace("_", " ")}`);

  // 5. Crawl (Full Site)
  let crawl: CrawlResult | null = null;
  if (full) {
    set("crawl", "running", `Up to ${input.maxPages} pages, depth ${input.maxDepth}`);
    try {
      crawl = await crawlSite({
        startUrl: finalUrl, startParsed: parsed, startStatus: res.status, startResponseMs: res.timeMs, startRedirects: res.redirects.length, startContentType: ctype || null,
        maxPages: input.maxPages, maxDepth: input.maxDepth, respectRobots: input.respectRobots, robots, sitemapUrls: sitemap.urls || [],
        fetcher: deps.fetcher, signal, budgetMs: deps.crawlBudgetMs, sleep: deps.sleep,
        onProgress: (p, cur) => {
          emit({ type: "pages", pages: p });
          const st = stages.find((s) => s.id === "crawl")!;
          st.detail = cur ? `Fetching ${cur}` : `${p.processed} processed, ${p.discovered} discovered`;
        },
      });
    } catch (e) {
      if (signal?.aborted) throw new AuditAbortedError("crawl");
      throw e;
    }
    guard();
    const c = crawl.summary;
    const reason = c.stopReason === "page_limit" ? `stopped at the ${input.maxPages}-page limit` : c.stopReason === "time_budget" ? "stopped at the time budget" : "all discovered pages within depth crawled";
    if (c.stopReason === "time_budget") partialReasons.push(`Crawl stopped after ${Math.round(c.durationMs / 1000)} s (time budget) with ${c.processed} of ${c.discovered} discovered URLs fetched.`);
    if (c.failed) warnings.push(`${c.failed} crawled URL(s) returned errors or could not be fetched.`);
    set("crawl", "completed", `${c.processed} URL(s) processed, ${c.discovered} discovered; ${reason}`);
  }

  const sitePages = crawl ? crawl.pages.filter((p) => p.parsed).map((p) => ({ url: p.item.finalUrl, parsed: p.parsed! })) : [{ url: finalUrl, parsed }];
  const ctx: CheckContext = {
    input, requestedUrl: target.toString(), url: finalUrl, status: res.status, headers: res.headers, redirects: res.redirects, htmlTruncated: res.truncated,
    parsed, robots, sitemap, sd: analyzeStructuredData([], []), canonicalProbe: null, linksChecked: [], images: [], imagesProbed: false,
    render: { status: "not_tested", viewports: [] }, performance: [], sitePages,
  };
  const checks: CheckResult[] = [];
  const add = (list: CheckResult[]) => {
    const at = now().toISOString();
    for (const c of list) checks.push({ ...c, source: sourceOf(c), detectedAt: c.detectedAt || at });
  };

  // 6. Technical SEO: canonical target, HTTP→HTTPS, security headers, indexability, links, accessibility.
  set("technical", "running", "Checking canonical, HTTPS and response headers");
  const canon = parsed.summary.canonical;
  if (canon && /^https?:/i.test(canon)) {
    if (normalizeForCompare(canon) === normalizeForCompare(finalUrl)) ctx.canonicalProbe = { url: canon, status: res.status, finalUrl };
    else {
      try {
        const c = await deps.fetcher.fetch(canon, { method: "HEAD", maxRedirects: 0, timeoutMs: LIMITS.subresourceTimeoutMs, signal });
        ctx.canonicalProbe = { url: canon, status: c.status, finalUrl: c.url };
      } catch (e) {
        ctx.canonicalProbe = { url: canon, status: null, finalUrl: null, error: (e as Error).message };
      }
    }
  }
  const security: SecuritySummary = {
    headers: Object.fromEntries(["strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy", "server", "x-powered-by"].map((h) => [h, res.headers[h] ?? null])),
    httpRedirectsToHttps: null,
    insecureCookies: insecureCookies(res.headers["set-cookie"]),
  };
  if (finalUrl.startsWith("https:")) {
    const httpUrl = new URL(finalUrl);
    httpUrl.protocol = "http:";
    try {
      const h = await deps.fetcher.fetch(httpUrl.toString(), { maxRedirects: 0, maxBytes: 4096, timeoutMs: LIMITS.subresourceTimeoutMs, signal });
      const loc = h.headers.location ? new URL(h.headers.location, httpUrl).toString() : "";
      if (h.status >= 300 && h.status < 400) security.httpRedirectsToHttps = loc.startsWith("https:");
      // Content served over plain HTTP proves there is no redirect; an error status (or a proxy refusal) proves nothing.
      else if (h.status >= 200 && h.status < 300) security.httpRedirectsToHttps = false;
      else security.httpCheckError = `The http:// version returned HTTP ${h.status}, so the redirect could not be determined.`;
    } catch (e) {
      if (signal?.aborted) throw new AuditAbortedError("technical");
      const code = (e as { code?: string }).code;
      if (code === "refused") security.httpRefused = true;
      security.httpCheckError = (e as Error).message;
    }
  }
  ctx.security = security;
  guard();
  const tech = technicalChecks(ctx);
  // Structured data and link checks are evaluated in their own stages, once their inputs exist.
  add(tech.filter((c) => c.category === "technical" && c.group !== "Structured data" && c.group !== "Links"));
  add(securityChecks(ctx));
  add(accessibilityChecks(ctx));
  const siteInput = crawl ? { startUrl: finalUrl, crawl, sitemapUrls: sitemap.urls || [], sitemapComplete: sitemap.status === "found" && !sitemap.truncated, startLinksChecked: [] as LinkRecord[] } : null;
  const site: CheckResult[] = siteInput ? siteChecks(siteInput) : [];
  add(site.filter((c) => c.category === "technical" && c.id !== "broken-internal-links"));
  set("technical", "completed", `${checks.length} technical, security and accessibility checks evaluated`);
  guard();

  // 7. Metadata & content
  set("content", "running", "Checking metadata, headings and content");
  const keyword = analyzeKeyword(ctx);
  const before = checks.length;
  add(tech.filter((c) => ONPAGE_GROUPS.has(c.group) && !(full && SITE_REPLACED.has(c.id))));
  add(contentChecks(ctx, keyword).filter((c) => !(full && SITE_REPLACED.has(c.id))));
  if (crawl) add(site.filter((c) => c.category === "onpage" || c.category === "content"));
  else add([anchorCheck([{ item: { finalUrl }, parsed }], finalUrl)]);
  set("content", "completed", `${checks.length - before} metadata and content checks${keyword ? `; keyword "${keyword.primary}" analysed` : ""}`);
  guard();

  // 8. Images & internal links
  set("assets", "running", "Requesting links and images");
  const crawledKeys = new Set(crawl ? crawl.pages.map((p) => normalizeForCompare(p.item.url)) : []);
  const internalLinks = parsed.links.filter((l) => l.internal && normalizeForCompare(l.href) !== normalizeForCompare(finalUrl) && !crawledKeys.has(normalizeForCompare(l.href)));
  const uniq = (ls: LinkRecord[]) => Array.from(new Map(ls.map((l) => [normalizeForCompare(l.href), l])).values());
  const toCheck = [...uniq(internalLinks).slice(0, input.linksToCheck), ...(input.checkExternalLinks ? uniq(parsed.links.filter((l) => !l.internal)).slice(0, 10) : [])];
  const images: ImageRecord[] = (crawl ? crawl.images : parsed.images).map((i) => ({ ...i }));
  const imagesToProbe = images.slice(0, LIMITS.maxImagesToProbe);
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
  await mapLimit(imagesToProbe, LIMITS.probeConcurrency, async (img) => {
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
  ctx.linksChecked = linksChecked.filter(Boolean);
  ctx.images = images;
  ctx.imagesProbed = imagesToProbe.length > 0;
  const unverifiedLinks = ctx.linksChecked.filter((l) => l.unverified).length + imagesToProbe.filter((i) => i.probe?.unverified).length;
  if (unverifiedLinks) warnings.push(`${unverifiedLinks} link(s) or image(s) could not be verified (timeouts or refused connections) and were not counted as broken.`);
  add(technicalChecks(ctx).filter((c) => c.group === "Links" && !(full && SITE_REPLACED.has(c.id))));
  if (siteInput) add(siteChecks({ ...siteInput, startLinksChecked: ctx.linksChecked }).filter((c) => c.id === "broken-internal-links"));
  add(imageChecks(ctx));
  set("assets", "completed", `Checked ${linksChecked.length} link(s) and ${imagesToProbe.length} of ${images.length} image(s)`);

  // 9. Structured data
  set("structured", "running", "Parsing JSON-LD and microdata");
  const sd: StructuredDataSummary = analyzeStructuredData(parsed.jsonLd, parsed.microdataTypes);
  ctx.sd = sd;
  add(technicalChecks(ctx).filter((c) => c.group === "Structured data"));
  set("structured", "completed", `${sd.jsonLdBlocks} JSON-LD block(s), ${sd.invalidBlocks.length} invalid; types: ${sd.types.slice(0, 5).join(", ") || "none"}`);
  guard();

  // 10-11. AEO and GEO
  set("aeo", "running");
  const aeo = aeoChecks(ctx);
  add(aeo);
  set("aeo", "completed", `${aeo.length} answer-readiness checks evaluated`);
  set("geo", "running");
  const geo = geoChecks(ctx);
  add(geo);
  set("geo", "completed", `${geo.length} GEO readiness checks evaluated`);
  guard();

  // Competitors (actually fetched pages only), alongside the remaining stages.
  const competitorUrls = (input.competitorUrls || []).slice(0, LIMITS.maxCompetitors);
  const competitorsPromise: Promise<CompetitorSnapshot[]> = Promise.all(competitorUrls.map(async (u, i) => {
    task(`competitor-${i}`, "report", `Competitor snapshot: ${u}`, "running");
    const snap = await fetchCompetitor(u, input, deps, signal);
    task(`competitor-${i}`, "report", `Competitor snapshot: ${u}`, snap.status === "ok" ? "completed" : "failed", snap.status === "ok" ? `HTTP ${snap.httpStatus}` : snap.error);
    return snap;
  }));

  // 12. Performance and mobile rendering
  let render: RenderResult;
  if (!input.renderJs) render = { status: "not_tested", error: "JavaScript rendering was disabled for this audit.", viewports: [] };
  else if (!renderPromise) render = { status: "not_tested", error: "Browser rendering is not configured on this server.", viewports: [] };
  else {
    set("performance", "running", psiPromise ? "Waiting for PageSpeed Insights and the rendered page" : "Waiting for the rendered page");
    render = await renderPromise;
    guard();
    if (render.status !== "ok") partialReasons.push(`Rendered mobile checks: ${render.error}`);
  }
  let performance: PerformanceResult[];
  if (!psiPromise) {
    performance = strategies.map((s) => notTestedPerformance(s, "Performance tests were disabled for this audit."));
    for (const s of strategies) task(`psi-${s}`, "performance", `PageSpeed Insights (${s})`, "skipped", "Disabled for this audit");
  } else {
    set("performance", "running", "Waiting for PageSpeed Insights");
    performance = await psiPromise;
    guard();
    for (const p of performance) if (p.status !== "ok") partialReasons.push(`Performance (${p.strategy}): ${p.error}`);
  }
  ctx.render = render;
  ctx.performance = performance;
  // The JavaScript-dependency check compares raw and rendered HTML, so it is finalised once rendering is done.
  const js = geoChecks(ctx).find((c) => c.id === "geo-js-dependency");
  const ji = checks.findIndex((c) => c.id === "geo-js-dependency");
  if (js && ji >= 0) checks[ji] = { ...js, source: sourceOf(js), detectedAt: now().toISOString() };
  add(performanceChecks(ctx));
  add(mobileChecks(ctx));
  // Lighthouse accessibility (reference only) needs the PSI result.
  add(lighthouseAccessibilityCheck(ctx));
  const perfOk = performance.filter((p) => p.status === "ok").length;
  if (!input.runPerformance && !renderPromise) set("performance", "skipped", "Performance tests and rendering disabled for this audit");
  else if (input.runPerformance && perfOk === 0 && render.status !== "ok") set("performance", "failed", performance.map((p) => `${p.strategy}: ${p.error}`).join("; "));
  else set("performance", "completed", [
    ...performance.map((p) => `${p.strategy}: ${p.status === "ok" ? p.score : p.error}`),
    render.status === "ok" ? "rendered checks done" : renderPromise ? `rendering failed` : "",
  ].filter(Boolean).join("; "));

  // Search Console (optional; failure never affects the rest).
  let searchConsole: SearchConsoleResult | undefined;
  if (gscPromise) {
    searchConsole = await gscPromise;
    guard();
    if (searchConsole.status === "error") warnings.push(searchConsole.message);
    if (searchConsole.status === "ok" && searchConsole.inspection && !searchConsole.inspection.error) {
      const ins = searchConsole.inspection;
      const i = checks.findIndex((c) => c.id === "google-index-status");
      const indexed = ins.verdict === "PASS";
      const replaced: CheckResult = {
        ...checks[i],
        status: indexed ? "pass" : ins.verdict === "FAIL" ? "fail" : "warning",
        explanation: `Google Search Console URL Inspection for ${searchConsole.property}: verdict ${ins.verdict ?? "n/a"}, coverage "${ins.coverageState ?? "n/a"}", indexing ${ins.indexingState ?? "n/a"}.`,
        recommendation: indexed ? "No action needed." : "Review the coverage state in Search Console and fix the reported reason.",
        detection: "Search Console URL Inspection API (verified property, Google's last crawl).",
        evidence: [ins.lastCrawlTime ? `Last crawl: ${ins.lastCrawlTime}` : "", ins.googleCanonical ? `Google-selected canonical: ${ins.googleCanonical}` : "", ins.robotsTxtState ? `robots.txt state: ${ins.robotsTxtState}` : ""].filter(Boolean),
        source: "external",
        limitation: "Reflects the indexed version at Google's last crawl, not a live test.",
      };
      if (i >= 0) checks[i] = replaced;
    }
  }

  // 13. Scoring
  set("scoring", "running");
  const scores = computeScores(checks);
  set("scoring", "completed", scores.overall.score === null ? "Overall score unavailable" : `Overall ${scores.overall.score}`);
  guard();

  // 14. Report
  set("report", "running", competitorUrls.length ? `Collecting ${competitorUrls.length} competitor snapshot(s)` : "Saving");
  const competitors = await competitorsPromise;
  guard();
  for (const c of competitors) if (c.status !== "ok") warnings.push(`Competitor ${c.url} could not be analysed: ${c.error}`);
  const siteSnapshot = competitors.length ? snapshotFromPage({ url: target.toString(), finalUrl, status: res.status, headers: res.headers, responseMs: res.timeMs, parsed, robots, input, fetchedAt: createdAt }) : undefined;
  const pages: PageInventoryItem[] = crawl
    ? crawl.pages.map((p) => p.item)
    : [inventoryItem(finalUrl, finalUrl, res.status, 0, "start", parsed, { contentType: ctype || null, responseMs: res.timeMs, redirects: res.redirects.length, xRobotsTag: parsed.summary.xRobotsTag })];
  const crawlSummary: CrawlSummary = crawl?.summary || { enabled: false, maxPages: 1, maxDepth: 0, discovered: 1, processed: 1, failed: 0, skippedRobots: 0, skippedOther: 0, stopReason: "not_run", sitemapUrlsUsed: 0, durationMs: 0 };
  const status: AuditRecordStatus = partialReasons.length || scores.overall.partial ? "partial" : warnings.length ? "completed_with_warnings" : "completed";
  const id = opts.id || randomUUID();
  const record: AuditRecord = {
    id,
    engineVersion: ENGINE_VERSION,
    createdAt,
    completedAt: now().toISOString(),
    status,
    ownerId: opts.ownerId || undefined,
    input,
    requestedUrl: target.toString(),
    finalUrl,
    httpStatus: res.status,
    redirects: res.redirects,
    responseTimeMs: res.timeMs,
    htmlBytes: res.body.length,
    htmlTruncated: res.truncated,
    pagesCrawled: crawl ? crawl.pages.filter((p) => p.parsed).length : 1,
    stages,
    tasks,
    crawl: crawlSummary,
    pages,
    security,
    competitors,
    siteSnapshot,
    searchConsole: searchConsole || {
      status: !deps.searchConsole ? "not_configured" : "not_connected",
      message: !deps.searchConsole ? "Not verified through Search Console: the integration is not configured on this server." : "Not verified through Search Console: it was not enabled for this audit.",
      limitations: [],
    },
    issueStates: {},
    warnings,
    page: parsed.summary,
    robots: robots.summary,
    sitemap: { ...sitemap, urls: undefined },
    images,
    links: {
      internal: parsed.links.filter((l) => l.internal).length,
      external: parsed.links.filter((l) => !l.internal).length,
      nofollow: parsed.links.filter((l) => l.nofollow).length,
      checked: ctx.linksChecked,
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
      ...(full ? [] : ["Quick Audit: only the submitted page was analysed. Duplicate metadata, duplicate content and orphan pages need a Full Site Audit."]),
      ...(crawl && crawl.summary.stopReason !== "complete" ? [`The crawl covered ${crawl.summary.processed} of ${crawl.summary.discovered} discovered URLs; site-level findings apply to the crawled pages only.`] : []),
      ...BASE_LIMITATIONS,
      ...(competitors.length ? ["Competitor snapshots analyse one page per competitor without performance, rendering or link checks, and are compared with the audited page scored the same way."] : []),
      ...partialReasons,
    ],
    integrations: {
      pagespeed: !input.runPerformance ? "Disabled for this audit" : deps.pageSpeedConfigured ? "Configured (API key)" : "Keyless shared quota",
      searchConsole: searchConsole?.status === "ok" ? `Connected (${searchConsole.property})` : !deps.searchConsole ? "Not configured" : input.useSearchConsole ? searchConsole?.message || "Not connected" : "Not used for this audit",
      ai: "Not configured",
      rendering: deps.renderingAvailable ? (input.renderJs ? "Enabled" : "Disabled for this audit") : "Not configured on server",
      keywordData: "Not connected (on-page keyword analysis only)",
      aiVisibility: "Not connected (GEO Readiness Assessment only)",
    },
  };
  await deps.save(record);
  set("report", "completed", "Saved");
  emit({ type: "done", auditId: id, status });
  return record;
}
