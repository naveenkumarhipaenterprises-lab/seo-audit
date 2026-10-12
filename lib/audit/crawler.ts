import { createHash } from "node:crypto";
import { parsePage, registrableHost, type ParsedPage } from "./parse";
import { normalizeForCompare } from "./sitemap";
import type { Fetcher } from "./fetcher";
import type { RobotsContext } from "./robots";
import type { CrawlProgress, CrawlSummary, ImageRecord, PageInventoryItem } from "./types";
import { CRAWLER_TOKEN, LIMITS } from "../config";

/** File extensions that are never HTML pages; links to them are not crawled. */
const NON_HTML_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|pdf|zip|gz|tgz|rar|7z|exe|dmg|msi|apk|mp[34]|m4[av]|mov|avi|wmv|webm|ogg|wav|flac|css|js|mjs|json|xml|rss|atom|txt|csv|xlsx?|docx?|pptx?|woff2?|ttf|otf|eot)$/i;
const THIN_WORDS = 200;
const SLOW_MS = 3000;
const TRANSIENT = new Set(["timeout", "reset", "refused"]);

export interface CrawledPage {
  item: PageInventoryItem;
  parsed: ParsedPage | null;
  /** Normalised internal link targets found on this page. */
  outLinks: string[];
  /** 5-word shingle hashes of the main text, for near-duplicate detection (not persisted). */
  shingles?: Set<number>;
  /** describeFetchError code when the fetch failed (only "dns" proves a dead link). */
  failCode?: string;
}

export interface CrawlResult {
  pages: CrawledPage[];
  summary: CrawlSummary;
  images: ImageRecord[];
  /** Internal links whose target was fetched and returned >= 400 or failed DNS. */
  brokenLinks: { from: string; to: string; status: number | null; error?: string }[];
  /** Internal links that point at a URL which redirects. */
  redirectingLinks: { from: string; to: string; finalUrl: string; hops: number }[];
  /** Normalised URL -> number of crawled pages linking to it. */
  inlinks: Map<string, number>;
  /** Links not followed because they were deeper than maxDepth. */
  depthLimited: number;
}

export interface CrawlOptions {
  startUrl: string;
  startParsed: ParsedPage;
  startStatus: number;
  startResponseMs: number;
  startRedirects: number;
  startContentType: string | null;
  maxPages: number;
  maxDepth: number;
  respectRobots: boolean;
  robots: RobotsContext;
  sitemapUrls: string[];
  fetcher: Fetcher;
  signal?: AbortSignal;
  budgetMs?: number;
  concurrency?: number;
  onProgress?: (p: CrawlProgress, current?: string) => void;
  /** Injectable sleep for retry backoff (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

/** Crawl-loop and trap prevention: overly long URLs, deep paths and repeating segments are not followed. */
export function isCrawlableUrl(u: string): boolean {
  if (u.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (NON_HTML_EXT.test(url.pathname)) return false;
  const segs = url.pathname.split("/").filter(Boolean);
  if (segs.length > 12) return false;
  const counts = new Map<string, number>();
  for (const s of segs) {
    counts.set(s, (counts.get(s) || 0) + 1);
    if ((counts.get(s) || 0) >= 3) return false;
  }
  if (url.searchParams.size > 6) return false;
  return true;
}

export function textFingerprint(text: string): string {
  return createHash("sha1").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

export function shingleSet(text: string, size = 5, cap = 2000): Set<number> {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const out = new Set<number>();
  for (let i = 0; i + size <= words.length && out.size < cap; i++) {
    const s = words.slice(i, i + size).join(" ");
    let h = 2166136261;
    for (let j = 0; j < s.length; j++) h = Math.imul(h ^ s.charCodeAt(j), 16777619);
    out.add(h >>> 0);
  }
  return out;
}

export function jaccard(a: Set<number>, b: Set<number>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function pageIssues(item: PageInventoryItem): string[] {
  const out: string[] = [];
  if (item.error) return [item.error];
  if (item.status !== null && (item.status < 200 || item.status >= 300)) out.push(`HTTP ${item.status}`);
  if (item.contentType && !/html/i.test(item.contentType)) return [...out, `Not an HTML page (${item.contentType.split(";")[0]})`];
  if (!item.title) out.push("Missing title");
  if (!item.description) out.push("Missing meta description");
  if (item.h1Count === 0) out.push("No H1");
  if (item.h1Count > 1) out.push(`${item.h1Count} H1 elements`);
  if (item.noindex) out.push("noindex");
  if (item.canonical && normalizeForCompare(item.canonical) !== normalizeForCompare(item.finalUrl)) out.push("Canonical points to another URL");
  if (item.wordCount < THIN_WORDS && item.status === 200) out.push(`Thin content (${item.wordCount} words)`);
  if (item.responseMs !== null && item.responseMs > SLOW_MS) out.push(`Slow response (${(item.responseMs / 1000).toFixed(1)} s)`);
  if (item.imagesMissingAlt) out.push(`${item.imagesMissingAlt} image(s) missing alt`);
  if (item.redirects) out.push(`Redirected (${item.redirects} hop${item.redirects > 1 ? "s" : ""})`);
  if (!item.lang) out.push("No html lang");
  return out;
}

export function inventoryItem(
  url: string, finalUrl: string, status: number | null, depth: number, foundVia: PageInventoryItem["foundVia"],
  parsed: ParsedPage | null, extra: { contentType: string | null; responseMs: number | null; redirects: number; xRobotsTag?: string | null; error?: string },
): PageInventoryItem {
  const s = parsed?.summary;
  const robots = [...(s?.robotsMeta || []), extra.xRobotsTag ? `x-robots-tag: ${extra.xRobotsTag.toLowerCase()}` : ""].join(" ");
  const noindex = /\bnoindex\b|\bnone\b/.test(robots);
  const h1s = s?.headings.filter((h) => h.level === 1) || [];
  const canonicalElsewhere = s?.canonical ? normalizeForCompare(s.canonical) !== normalizeForCompare(finalUrl) : false;
  const item: PageInventoryItem = {
    url,
    finalUrl,
    status,
    depth,
    foundVia,
    contentType: extra.contentType,
    responseMs: extra.responseMs,
    redirects: extra.redirects,
    title: s?.title || null,
    description: s?.metaDescription || null,
    h1: h1s[0]?.text || null,
    h1Count: h1s.length,
    canonical: s?.canonical || null,
    noindex,
    indexable: status === null ? null : status >= 200 && status < 300 && !noindex && !canonicalElsewhere,
    wordCount: s?.mainWordCount ?? s?.wordCount ?? 0,
    inlinks: 0,
    internalLinksOut: parsed ? new Set(parsed.links.filter((l) => l.internal).map((l) => normalizeForCompare(l.href))).size : 0,
    images: parsed?.images.length || 0,
    imagesMissingAlt: parsed?.images.filter((i) => i.altState === "missing").length || 0,
    lang: s?.lang || null,
    issues: [],
    error: extra.error,
    contentHash: parsed && parsed.mainText.split(" ").length >= 50 ? textFingerprint(parsed.mainText) : undefined,
  };
  item.issues = pageIssues(item);
  return item;
}

/**
 * Bounded breadth-first crawl of internal HTML pages. Every request goes through the
 * injected Fetcher (SSRF-guarded in production); limits on pages, depth, time,
 * concurrency and URL shape keep the crawl finite.
 */
export async function crawlSite(o: CrawlOptions): Promise<CrawlResult> {
  const t0 = Date.now();
  const budget = o.budgetMs ?? LIMITS.crawlTimeBudgetMs;
  const concurrency = Math.max(1, Math.min(o.concurrency ?? LIMITS.crawlConcurrency, 6));
  const sleep = o.sleep || ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const host = registrableHost(new URL(o.startUrl).hostname);
  const inScope = (u: string) => {
    try {
      return registrableHost(new URL(u).hostname) === host;
    } catch {
      return false;
    }
  };

  const seen = new Set<string>([normalizeForCompare(o.startUrl)]);
  const finals = new Map<string, CrawledPage>();
  const queue: { url: string; depth: number; via: PageInventoryItem["foundVia"]; from: string }[] = [];
  const linkSources = new Map<string, string>(); // target -> first page linking to it
  const pages: CrawledPage[] = [];
  let skippedRobots = 0;
  let skippedOther = 0;
  let depthLimited = 0;
  let failed = 0;
  let stopReason: CrawlSummary["stopReason"] = "complete";

  const startItem = inventoryItem(o.startUrl, o.startUrl, o.startStatus, 0, "start", o.startParsed, {
    contentType: o.startContentType, responseMs: o.startResponseMs, redirects: o.startRedirects, xRobotsTag: o.startParsed.summary.xRobotsTag,
  });
  const startPage: CrawledPage = {
    item: startItem,
    parsed: o.startParsed,
    outLinks: Array.from(new Set(o.startParsed.links.filter((l) => l.internal).map((l) => normalizeForCompare(l.href)))),
    shingles: shingleSet(o.startParsed.mainText),
  };
  pages.push(startPage);
  finals.set(normalizeForCompare(o.startUrl), startPage);

  const enqueueLinks = (page: CrawledPage, depth: number) => {
    if (!page.parsed) return;
    for (const l of page.parsed.links) {
      if (!l.internal || l.nofollow) continue;
      const key = normalizeForCompare(l.href);
      if (!linkSources.has(key)) linkSources.set(key, page.item.finalUrl);
      if (seen.has(key)) continue;
      if (!inScope(l.href) || !isCrawlableUrl(l.href)) continue;
      if (depth + 1 > o.maxDepth) {
        depthLimited++;
        continue;
      }
      seen.add(key);
      queue.push({ url: l.href, depth: depth + 1, via: "link", from: page.item.finalUrl });
    }
  };
  enqueueLinks(startPage, 0);
  // Sitemap URLs are lower priority seeds: they go after the first level of links.
  let sitemapUsed = 0;
  for (const u of o.sitemapUrls) {
    if (sitemapUsed >= LIMITS.maxSitemapSeeds) break;
    const key = normalizeForCompare(u);
    if (seen.has(key) || !inScope(u) || !isCrawlableUrl(u)) continue;
    seen.add(key);
    sitemapUsed++;
    queue.push({ url: u, depth: 1, via: "sitemap", from: "sitemap" });
  }

  const progress = (current?: string) =>
    o.onProgress?.({ discovered: seen.size, processed: pages.length - skippedRobots, failed, limit: Math.min(o.maxPages, seen.size - skippedRobots) }, current);
  progress();

  let inFlight = 0;
  const fetchPage = async (job: (typeof queue)[number]): Promise<void> => {
    if (o.respectRobots && o.robots.isAllowed(job.url, CRAWLER_TOKEN) === false) {
      skippedRobots++;
      pages.push({ item: inventoryItem(job.url, job.url, null, job.depth, job.via, null, { contentType: null, responseMs: null, redirects: 0, error: `Blocked by robots.txt for ${CRAWLER_TOKEN}; not fetched` }), parsed: null, outLinks: [] });
      return;
    }
    let attempt = 0;
    for (;;) {
      try {
        const res = await o.fetcher.fetch(job.url, { signal: o.signal, maxBytes: LIMITS.maxHtmlBytes, timeoutMs: LIMITS.pageTimeoutMs });
        if ([502, 503, 504].includes(res.status) && attempt === 0) {
          attempt++;
          await sleep(1000);
          continue;
        }
        const ctype = res.headers["content-type"] || null;
        const finalKey = normalizeForCompare(res.url);
        if (!inScope(res.url)) {
          pages.push({ item: inventoryItem(job.url, res.url, res.status, job.depth, job.via, null, { contentType: ctype, responseMs: res.timeMs, redirects: res.redirects.length, error: `Redirects off-site to ${res.url}; not analysed` }), parsed: null, outLinks: [] });
          return;
        }
        const existing = finals.get(finalKey);
        // Reached directly after an earlier redirect already analysed it: nothing new to record.
        if (existing && finalKey === normalizeForCompare(job.url)) return;
        if (existing) {
          pages.push({ item: { ...inventoryItem(job.url, res.url, res.status, job.depth, job.via, null, { contentType: ctype, responseMs: res.timeMs, redirects: res.redirects.length }), issues: [`Redirects to an already crawled page (${res.redirects.length} hop${res.redirects.length === 1 ? "" : "s"})`] }, parsed: null, outLinks: [] });
          return;
        }
        if (ctype && !/html/i.test(ctype)) {
          pages.push({ item: inventoryItem(job.url, res.url, res.status, job.depth, job.via, null, { contentType: ctype, responseMs: res.timeMs, redirects: res.redirects.length }), parsed: null, outLinks: [] });
          return;
        }
        const parsed = res.status < 400 ? parsePage(res.body.toString("utf8"), res.url) : null;
        if (parsed) parsed.summary.xRobotsTag = res.headers["x-robots-tag"] || null;
        const page: CrawledPage = {
          item: inventoryItem(job.url, res.url, res.status, job.depth, job.via, parsed, { contentType: ctype, responseMs: res.timeMs, redirects: res.redirects.length, xRobotsTag: res.headers["x-robots-tag"] || null }),
          parsed,
          outLinks: parsed ? Array.from(new Set(parsed.links.filter((l) => l.internal).map((l) => normalizeForCompare(l.href)))) : [],
          shingles: parsed ? shingleSet(parsed.mainText) : undefined,
        };
        if (res.status >= 400) failed++;
        pages.push(page);
        finals.set(finalKey, page);
        // noindex pages can still pass links ("noindex, follow"), so their links are followed too.
        if (parsed) enqueueLinks(page, job.depth);
        return;
      } catch (e) {
        if (o.signal?.aborted) throw e;
        const code = (e as { code?: string }).code || "";
        if (TRANSIENT.has(code) && attempt === 0) {
          attempt++;
          await sleep(1000);
          continue;
        }
        failed++;
        pages.push({ item: inventoryItem(job.url, job.url, null, job.depth, job.via, null, { contentType: null, responseMs: null, redirects: 0, error: `Fetch failed: ${(e as Error).message}` }), parsed: null, outLinks: [], failCode: code });
        return;
      }
    }
  };

  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      if (o.signal?.aborted) {
        stopReason = "cancelled";
        if (inFlight === 0) resolve();
        return;
      }
      while (inFlight < concurrency && queue.length) {
        // URLs skipped by robots.txt are listed but do not use up the page budget.
        if (pages.length - skippedRobots + inFlight >= o.maxPages) {
          stopReason = "page_limit";
          break;
        }
        if (Date.now() - t0 > budget) {
          stopReason = "time_budget";
          break;
        }
        // Breadth-first: always take the shallowest queued URL.
        let best = 0;
        for (let i = 1; i < queue.length; i++) if (queue[i].depth < queue[best].depth) best = i;
        const job = queue.splice(best, 1)[0];
        inFlight++;
        progress(job.url);
        fetchPage(job)
          .then(() => {
            inFlight--;
            progress();
            pump();
          })
          .catch((e) => {
            inFlight--;
            if (o.signal?.aborted) {
              stopReason = "cancelled";
              if (inFlight === 0) resolve();
            } else reject(e);
          });
      }
      if (inFlight === 0 && (!queue.length || stopReason !== "complete")) resolve();
    };
    pump();
  });
  skippedOther += queue.length;

  // Link graph: inlinks, broken and redirecting internal links.
  const inlinks = new Map<string, number>();
  for (const p of pages) for (const t of p.outLinks) if (t !== normalizeForCompare(p.item.finalUrl)) inlinks.set(t, (inlinks.get(t) || 0) + 1);
  const byUrl = new Map<string, CrawledPage>();
  for (const p of pages) {
    byUrl.set(normalizeForCompare(p.item.url), p);
    if (!byUrl.has(normalizeForCompare(p.item.finalUrl))) byUrl.set(normalizeForCompare(p.item.finalUrl), p);
  }
  for (const p of pages) {
    p.item.inlinks = (inlinks.get(normalizeForCompare(p.item.url)) || 0) + (p.item.url !== p.item.finalUrl ? inlinks.get(normalizeForCompare(p.item.finalUrl)) || 0 : 0);
  }
  const brokenLinks: CrawlResult["brokenLinks"] = [];
  const redirectingLinks: CrawlResult["redirectingLinks"] = [];
  for (const p of pages) {
    for (const t of p.outLinks) {
      const target = byUrl.get(t);
      if (!target || target === p) continue;
      const it = target.item;
      if ((it.status !== null && it.status >= 400) || (it.status === null && target.failCode === "dns")) {
        if (brokenLinks.length < 200) brokenLinks.push({ from: p.item.finalUrl, to: it.url, status: it.status, error: it.error });
      } else if (it.redirects > 0 && normalizeForCompare(it.url) === t && redirectingLinks.length < 200) {
        redirectingLinks.push({ from: p.item.finalUrl, to: it.url, finalUrl: it.finalUrl, hops: it.redirects });
      }
    }
  }

  // Site-wide image inventory (deduplicated by URL; first page that uses it is the source).
  const images: ImageRecord[] = [];
  const seenImg = new Set<string>();
  for (const p of pages) for (const img of p.parsed?.images || []) {
    if (seenImg.has(img.src)) continue;
    seenImg.add(img.src);
    images.push({ ...img });
  }

  return {
    pages,
    images,
    brokenLinks,
    redirectingLinks,
    inlinks,
    depthLimited,
    summary: {
      enabled: true,
      maxPages: o.maxPages,
      maxDepth: o.maxDepth,
      discovered: seen.size,
      processed: pages.length - skippedRobots,
      failed,
      skippedRobots,
      skippedOther,
      stopReason,
      sitemapUrlsUsed: sitemapUsed,
      durationMs: Date.now() - t0,
    },
  };
}
