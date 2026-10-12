import { check } from "./context";
import type { CrawlResult, CrawledPage } from "../crawler";
import { jaccard } from "../crawler";
import { normalizeForCompare } from "../sitemap";
import type { Category, CheckResult, CheckStatus, FindingSource, LinkRecord, Severity } from "../types";

const GENERIC_ANCHORS = /^(click here|here|read more|more|learn more|this|link|this page|details|continue|go|see more|view more|find out more)$/i;
const NEAR_DUP = 0.9;

interface SiteCtx {
  startUrl: string;
  crawl: CrawlResult;
  sitemapUrls: string[];
  sitemapComplete: boolean;
  startLinksChecked: LinkRecord[];
}

function mk(category: Category, group: string, startUrl: string, source: FindingSource = "observed") {
  return (id: string, title: string, status: CheckStatus, severity: Severity, explanation: string, recommendation: string, detection: string,
    evidence: string[] = [], affectedUrls: string[] = [], limitation?: string): CheckResult =>
    ({ ...check({ id, category, group, title, status, severity, url: startUrl, explanation, recommendation, detection, evidence, limitation }), source, affectedUrls: affectedUrls.slice(0, 200) });
}

const htmlPages = (pages: CrawledPage[]) => pages.filter((p) => p.parsed && p.item.status !== null && p.item.status >= 200 && p.item.status < 300);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function groupDuplicates(pages: CrawledPage[], key: (p: CrawledPage) => string | null): [string, CrawledPage[]][] {
  const m = new Map<string, CrawledPage[]>();
  for (const p of pages) {
    const k = key(p);
    if (!k) continue;
    const list = m.get(k) || [];
    list.push(p);
    m.set(k, list);
  }
  return Array.from(m.entries()).filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
}

/**
 * Site-level checks built from the Full Site crawl. They replace the single-page
 * placeholders (duplicate metadata/content, orphan pages, broken internal links).
 */
export function siteChecks(s: SiteCtx): CheckResult[] {
  const out: CheckResult[] = [];
  const pages = s.crawl.pages;
  const ok = htmlPages(pages);
  // Only indexable pages compete in search results; duplicates among noindexed/canonicalised pages are expected.
  const indexable = ok.filter((p) => p.item.indexable);
  const n = ok.length;
  const meta = mk("onpage", "Site-wide metadata", s.startUrl);
  const tech = mk("technical", "Site crawl", s.startUrl);
  const cont = mk("content", "Site-wide content", s.startUrl);
  const crawlNote = `Based on ${plural(pages.length, "crawled URL")} (${plural(n, "HTML page")} with HTTP 2xx).`;
  const scopeLimit = s.crawl.summary.stopReason === "complete" ? undefined : "The crawl stopped before every discovered URL was fetched, so pages outside the crawl are not covered.";

  // ---- Metadata
  const missingTitle = ok.filter((p) => !p.item.title);
  out.push(meta("site-missing-titles", "Pages without a title", n === 0 ? "not_tested" : missingTitle.length ? "fail" : "pass", "high",
    missingTitle.length ? `${plural(missingTitle.length, "page")} of ${n} have no <title>.` : `All ${n} crawled HTML pages have a title.`,
    missingTitle.length ? "Add a unique, descriptive <title> to each page." : "No action needed.", crawlNote,
    missingTitle.slice(0, 25).map((p) => p.item.finalUrl), missingTitle.map((p) => p.item.finalUrl), scopeLimit));
  const dupTitles = groupDuplicates(indexable, (p) => p.item.title?.trim().toLowerCase() || null);
  const dupTitlePages = dupTitles.flatMap(([, v]) => v);
  out.push(meta("duplicate-titles-sitewide", "Duplicate titles across pages", indexable.length < 2 ? "not_tested" : dupTitles.length ? "warning" : "pass", "medium",
    dupTitles.length ? `${plural(dupTitles.length, "title")} ${dupTitles.length === 1 ? "is" : "are"} shared by more than one indexable page (${plural(dupTitlePages.length, "page")} affected). Duplicate titles make it harder for search engines and users to tell pages apart.` : `No duplicate titles among ${plural(indexable.length, "indexable page")}.`,
    dupTitles.length ? "Give each indexable page a distinct title that describes its specific content." : "No action needed.",
    "Compared normalised <title> text across indexable crawled pages (2xx, no noindex, self-canonical).",
    dupTitles.slice(0, 10).map(([t, v]) => `"${t.slice(0, 80)}" on ${v.length} pages: ${v.slice(0, 3).map((p) => p.item.finalUrl).join(", ")}${v.length > 3 ? " …" : ""}`),
    dupTitlePages.map((p) => p.item.finalUrl), scopeLimit));
  const missingDesc = ok.filter((p) => !p.item.description);
  out.push(meta("site-missing-descriptions", "Pages without a meta description", n === 0 ? "not_tested" : missingDesc.length ? "warning" : "pass", "medium",
    missingDesc.length ? `${plural(missingDesc.length, "page")} of ${n} have no meta description; search engines will generate a snippet from page text.` : `All ${n} crawled HTML pages have a meta description.`,
    missingDesc.length ? "Write a concise description for important pages." : "No action needed.", crawlNote,
    missingDesc.slice(0, 25).map((p) => p.item.finalUrl), missingDesc.map((p) => p.item.finalUrl), "Search engines may show a different snippet even when a description exists."));
  const dupDesc = groupDuplicates(indexable, (p) => p.item.description?.trim().toLowerCase() || null);
  const dupDescPages = dupDesc.flatMap(([, v]) => v);
  out.push(meta("duplicate-descriptions-sitewide", "Duplicate meta descriptions", indexable.length < 2 ? "not_tested" : dupDesc.length ? "warning" : "pass", "low",
    dupDesc.length ? `${plural(dupDesc.length, "description")} ${dupDesc.length === 1 ? "is" : "are"} reused on several indexable pages (${plural(dupDescPages.length, "page")}).` : `No duplicate descriptions among ${plural(indexable.length, "indexable page")}.`,
    dupDesc.length ? "Write descriptions specific to each page, or leave them out where a generic one adds nothing." : "No action needed.",
    "Compared normalised meta description text across indexable crawled pages.",
    dupDesc.slice(0, 10).map(([t, v]) => `"${t.slice(0, 80)}" on ${v.length} pages`), dupDescPages.map((p) => p.item.finalUrl)));
  const h1Bad = ok.filter((p) => p.item.h1Count !== 1);
  out.push(meta("site-h1", "Pages with no H1 or several H1s", n === 0 ? "not_tested" : h1Bad.some((p) => p.item.h1Count === 0) ? "warning" : h1Bad.length ? "info" : "pass", "low",
    h1Bad.length ? `${plural(ok.filter((p) => p.item.h1Count === 0).length, "page")} have no H1 and ${plural(ok.filter((p) => p.item.h1Count > 1).length, "page")} have more than one. Multiple H1s are valid HTML and not a confirmed ranking penalty; the concern is an unclear main heading.` : `Every crawled page has exactly one H1.`,
    h1Bad.length ? "Give each page one clear main heading that matches its topic." : "No action needed.", crawlNote,
    h1Bad.slice(0, 25).map((p) => `${p.item.finalUrl}: ${p.item.h1Count} H1`), h1Bad.map((p) => p.item.finalUrl)));

  // ---- Crawlability & indexability
  const errors = pages.filter((p) => p.item.status !== null && p.item.status >= 400);
  out.push(tech("site-http-errors", "Pages returning errors", errors.length ? "fail" : "pass", "high",
    errors.length ? `${plural(errors.length, "crawled URL")} returned HTTP 4xx/5xx.` : "No crawled URL returned an HTTP error.",
    errors.length ? "Fix or redirect these URLs and update the links that point to them." : "No action needed.",
    "HTTP status of each crawled URL after redirects.", errors.slice(0, 25).map((p) => `HTTP ${p.item.status}: ${p.item.url}`), errors.map((p) => p.item.url), scopeLimit));

  // Broken internal links: links on crawled pages to crawled URLs that failed, plus start-page probes.
  const broken = [...s.crawl.brokenLinks];
  for (const l of s.startLinksChecked) {
    if (!l.internal) continue;
    const bad = (l.status !== null && l.status !== undefined && l.status >= 400) || (l.status === null && !l.unverified);
    if (bad && !broken.some((b) => normalizeForCompare(b.to) === normalizeForCompare(l.href))) broken.push({ from: s.startUrl, to: l.href, status: l.status ?? null, error: l.error });
  }
  const unverified = s.startLinksChecked.filter((l) => l.internal && l.unverified).length;
  out.push(tech("broken-internal-links", "Broken internal links", broken.length ? "fail" : "pass", "high",
    broken.length ? `${plural(broken.length, "internal link")} point to URLs that returned an error or do not resolve.` : `No broken internal links found among links to the ${plural(pages.length, "crawled URL")}.`,
    broken.length ? "Update or remove these links, or redirect the target URLs." : "No action needed.",
    "Internal links on crawled pages whose target was fetched during the crawl, plus HEAD/GET probes of start-page links.",
    broken.slice(0, 25).map((b) => `${b.from} → ${b.to} (${b.status ? `HTTP ${b.status}` : b.error || "failed"})`),
    Array.from(new Set(broken.map((b) => b.from))),
    `Links to URLs outside the crawl were not tested.${unverified ? ` ${plural(unverified, "start-page link")} could not be verified (timeout or network refusal) and are not counted as broken.` : ""}`));

  const redirecting = s.crawl.redirectingLinks;
  out.push(tech("site-internal-redirects", "Internal links to redirecting URLs", redirecting.length ? "warning" : "pass", "low",
    redirecting.length ? `${plural(redirecting.length, "internal link")} point at URLs that redirect. Each hop adds latency and dilutes crawl efficiency.` : "Internal links point directly at final URLs.",
    redirecting.length ? "Link straight to the final destination URL." : "No action needed.", "Compared crawled link targets with their redirect destinations.",
    redirecting.slice(0, 25).map((r) => `${r.from} → ${r.to} → ${r.finalUrl} (${plural(r.hops, "hop")})`), Array.from(new Set(redirecting.map((r) => r.from)))));

  const chains = pages.filter((p) => p.item.redirects > 1);
  if (chains.length) {
    out.push(tech("site-redirect-chains", "Redirect chains", "warning", "medium",
      `${plural(chains.length, "crawled URL")} pass through more than one redirect.`, "Collapse chains into a single redirect to the final URL.",
      "Followed redirects manually for each crawled URL.", chains.slice(0, 25).map((p) => `${p.item.url} → ${p.item.finalUrl} (${p.item.redirects} hops)`), chains.map((p) => p.item.url)));
  }

  const sitemapSet = new Set(s.sitemapUrls.map(normalizeForCompare));
  const noindexPages = ok.filter((p) => p.item.noindex);
  const noindexInSitemap = noindexPages.filter((p) => sitemapSet.has(normalizeForCompare(p.item.url)) || sitemapSet.has(normalizeForCompare(p.item.finalUrl)));
  out.push(tech("site-noindex", "Pages with noindex", noindexInSitemap.length ? "warning" : noindexPages.length ? "info" : "pass", "medium",
    noindexInSitemap.length ? `${plural(noindexInSitemap.length, "noindex page")} are also listed in the XML sitemap, which sends conflicting signals.` : noindexPages.length ? `${plural(noindexPages.length, "crawled page")} carry noindex. This may be intentional (e.g. account or thank-you pages).` : "No crawled page carries a noindex directive.",
    noindexInSitemap.length ? "Remove noindex pages from the sitemap, or remove noindex if the pages should be indexed." : noindexPages.length ? "Confirm these pages are meant to be excluded from search." : "No action needed.",
    "robots meta tags and X-Robots-Tag headers on crawled pages, compared with sitemap URLs.",
    (noindexInSitemap.length ? noindexInSitemap : noindexPages).slice(0, 25).map((p) => p.item.finalUrl), noindexPages.map((p) => p.item.finalUrl)));

  const canonOther = ok.filter((p) => p.item.canonical && normalizeForCompare(p.item.canonical) !== normalizeForCompare(p.item.finalUrl));
  const byUrl = new Map(pages.map((p) => [normalizeForCompare(p.item.finalUrl), p]));
  const badCanon = canonOther.filter((p) => {
    const t = byUrl.get(normalizeForCompare(p.item.canonical!));
    return t && ((t.item.status !== null && t.item.status >= 300) || t.item.noindex);
  });
  out.push(tech("site-canonical-conflicts", "Canonical conflicts", badCanon.length ? "fail" : canonOther.length ? "info" : "pass", "high",
    badCanon.length ? `${plural(badCanon.length, "page")} declare a canonical URL that redirects, errors or is noindex.` : canonOther.length ? `${plural(canonOther.length, "page")} canonicalise to a different URL (expected for duplicates and parameter URLs).` : "Every crawled page that declares a canonical points to itself.",
    badCanon.length ? "Point canonicals at the final, indexable 200 URL." : "No action needed.", "Compared each page's rel=canonical with the crawled status of the target.",
    (badCanon.length ? badCanon : canonOther).slice(0, 25).map((p) => `${p.item.finalUrl} → ${p.item.canonical}`), (badCanon.length ? badCanon : canonOther).map((p) => p.item.finalUrl)));

  // Sitemap URL validity: sitemap URLs that were crawled and are not 200/indexable.
  const crawledSitemap = pages.filter((p) => sitemapSet.has(normalizeForCompare(p.item.url)));
  const invalidSitemap = crawledSitemap.filter((p) => p.item.status !== 200 || p.item.redirects > 0 || p.item.noindex || (p.item.canonical && normalizeForCompare(p.item.canonical) !== normalizeForCompare(p.item.finalUrl)));
  out.push(tech("sitemap-url-validity", "Sitemap URL validity", crawledSitemap.length === 0 ? "not_tested" : invalidSitemap.length ? "warning" : "pass", "medium",
    crawledSitemap.length === 0 ? "No sitemap URLs were crawled." : invalidSitemap.length ? `${plural(invalidSitemap.length, "sitemap URL")} of ${crawledSitemap.length} crawled are not 200, redirect, are noindex, or canonicalise elsewhere.` : `All ${plural(crawledSitemap.length, "crawled sitemap URL")} return 200 and are self-canonical and indexable.`,
    invalidSitemap.length ? "List only final, canonical, indexable URLs in the sitemap." : "No action needed.", "Crawled sitemap URLs and compared their status, redirects, robots directives and canonical.",
    invalidSitemap.slice(0, 25).map((p) => `${p.item.url}: ${p.item.issues.slice(0, 3).join(", ") || `HTTP ${p.item.status}`}`), invalidSitemap.map((p) => p.item.url),
    `${crawledSitemap.length} of ${s.sitemapUrls.length} sitemap URLs read were crawled.`));

  // Orphans need a complete crawl: otherwise an uncrawled page might link to the URL.
  const complete = s.crawl.summary.stopReason === "complete" && s.crawl.depthLimited === 0 && s.sitemapComplete;
  const sameHostSitemap = s.sitemapUrls.filter((u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "") === new URL(s.startUrl).hostname.replace(/^www\./, "");
    } catch {
      return false;
    }
  });
  const orphans = complete ? sameHostSitemap.filter((u) => !s.crawl.inlinks.get(normalizeForCompare(u)) && normalizeForCompare(u) !== normalizeForCompare(s.startUrl)) : [];
  out.push(tech("orphan-pages", "Orphan page candidates", !complete || !sameHostSitemap.length ? "not_tested" : orphans.length ? "warning" : "pass", "medium",
    !sameHostSitemap.length ? "No sitemap URLs were available to compare against the crawl." : !complete ? "Orphan detection needs a complete crawl of every linked page, but the crawl stopped at the page or depth limit, so a page outside the crawl could still link to these URLs." : orphans.length ? `${plural(orphans.length, "sitemap URL")} received no internal links from any crawled page.` : "Every sitemap URL is linked from at least one crawled page.",
    orphans.length ? "Link to these pages from relevant pages or navigation, or remove them from the sitemap if obsolete." : complete ? "No action needed." : "Increase max pages and depth to allow a complete crawl.",
    "Compared sitemap URLs with internal link targets found on all crawled pages.", orphans.slice(0, 25), orphans,
    "Links injected by JavaScript are not seen by the static crawl."));

  const blocked = pages.filter((p) => p.item.error?.startsWith("Blocked by robots.txt"));
  const failedFetch = pages.filter((p) => p.item.status === null && !p.item.error?.startsWith("Blocked by robots.txt"));
  out.push(tech("site-inaccessible", "Blocked or inaccessible pages", failedFetch.length ? "warning" : blocked.length ? "info" : "pass", "medium",
    `${plural(blocked.length, "URL")} blocked by robots.txt for this crawler and ${plural(failedFetch.length, "URL")} that could not be fetched (timeouts, connection errors, off-site redirects).`,
    failedFetch.length ? "Check server availability for these URLs; repeated timeouts also affect search engine crawling." : blocked.length ? "Confirm the robots.txt rules are intended." : "No action needed.",
    "Crawl fetch outcomes.", [...blocked, ...failedFetch].slice(0, 25).map((p) => `${p.item.url}: ${p.item.error}`), [...blocked, ...failedFetch].map((p) => p.item.url),
    "A fetch failure from this server does not prove search engines see the same failure."));

  const slow = ok.filter((p) => (p.item.responseMs ?? 0) > 3000);
  out.push(tech("site-slow-pages", "Slow server responses", n === 0 ? "not_tested" : slow.length ? "warning" : "pass", "low",
    slow.length ? `${plural(slow.length, "page")} took more than 3 s to download.` : `All ${n} pages downloaded in under 3 s from this server.`,
    slow.length ? "Investigate server response time and caching for these pages." : "No action needed.", "Time to download each HTML document from the audit server.",
    slow.slice(0, 25).map((p) => `${p.item.finalUrl}: ${((p.item.responseMs ?? 0) / 1000).toFixed(1)} s`), slow.map((p) => p.item.finalUrl),
    "Measured from one location; includes network distance to the audit server. Not a Core Web Vitals measurement."));

  // ---- Content
  const exact = groupDuplicates(indexable, (p) => p.item.contentHash || null);
  const near: [CrawledPage, CrawledPage, number][] = [];
  const pool = indexable.filter((p) => p.shingles && p.shingles.size >= 20).slice(0, 100);
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++) {
      if (pool[i].item.contentHash && pool[i].item.contentHash === pool[j].item.contentHash) continue;
      const sim = jaccard(pool[i].shingles!, pool[j].shingles!);
      if (sim >= NEAR_DUP) near.push([pool[i], pool[j], sim]);
    }
  const dupPages = new Set([...exact.flatMap(([, v]) => v.map((p) => p.item.finalUrl)), ...near.flatMap(([a, b]) => [a.item.finalUrl, b.item.finalUrl])]);
  out.push(cont("duplicate-content", "Duplicate or near-duplicate content", indexable.length < 2 ? "not_tested" : dupPages.size ? "warning" : "pass", "medium",
    dupPages.size ? `${plural(dupPages.size, "indexable page")} share identical or ≥90% overlapping main text with another page.` : `No duplicate main content among ${plural(indexable.length, "indexable page")}.`,
    dupPages.size ? "Consolidate duplicates, differentiate their content, or canonicalise them to one URL." : "No action needed.",
    "Fingerprint of the normalised main text plus 5-word shingle Jaccard similarity between crawled pages.",
    [...exact.slice(0, 5).map(([, v]) => `Identical: ${v.slice(0, 4).map((p) => p.item.finalUrl).join(", ")}`), ...near.slice(0, 10).map(([a, b, sim]) => `${Math.round(sim * 100)}% overlap: ${a.item.finalUrl} ↔ ${b.item.finalUrl}`)],
    Array.from(dupPages), "Shared navigation and footer text is excluded where pages use <main>/<article>; otherwise it can inflate similarity."));

  const thin = ok.filter((p) => p.item.wordCount < 200 && p.item.indexable);
  out.push(cont("site-thin-content", "Thin pages", n === 0 ? "not_tested" : thin.length ? "warning" : "pass", "low",
    thin.length ? `${plural(thin.length, "indexable page")} have under 200 words of main content.` : `All indexable pages have at least 200 words of main content.`,
    thin.length ? "Expand pages that should rank, or consolidate/noindex pages with little unique value. Some page types (contact, category) are legitimately short." : "No action needed.",
    "Word count of the main content area (main/article, excluding nav, header, footer, aside).", thin.slice(0, 25).map((p) => `${p.item.finalUrl}: ${p.item.wordCount} words`), thin.map((p) => p.item.finalUrl),
    "Word count is a rough signal; length alone does not determine quality."));

  const weak = ok.filter((p) => p.item.depth > 0 && p.item.inlinks <= 1 && p.item.indexable);
  out.push(cont("site-internal-linking", "Weakly linked pages", n < 3 ? "not_tested" : weak.length ? "info" : "pass", "low",
    weak.length ? `${plural(weak.length, "indexable page")} are linked from at most one crawled page. These are internal linking opportunities.` : "Every crawled page receives links from at least two crawled pages.",
    weak.length ? "Add contextual links to these pages from related content." : "No action needed.", "Counted internal links between crawled pages.",
    weak.slice(0, 25).map((p) => `${p.item.finalUrl}: ${plural(p.item.inlinks, "inlink")}`), weak.map((p) => p.item.finalUrl), "Only links among crawled pages are counted."));

  out.push(anchorCheck(pages, s.startUrl));
  return out;
}

/** Generic anchor text ("click here", "read more") across the given pages (start page only in Quick mode). */
export function anchorCheck(pages: { item: { finalUrl: string }; parsed: CrawledPage["parsed"] }[], startUrl: string): CheckResult {
  const found: { page: string; text: string; href: string }[] = [];
  let total = 0;
  for (const p of pages) for (const l of p.parsed?.links || []) {
    if (!l.internal) continue;
    total++;
    if (GENERIC_ANCHORS.test(l.text.trim())) found.push({ page: p.item.finalUrl, text: l.text, href: l.href });
  }
  const c = mk("content", pages.length > 1 ? "Site-wide content" : "Content", startUrl);
  return c("descriptive-anchors", "Descriptive anchor text", total === 0 ? "not_applicable" : found.length ? "warning" : "pass", "low",
    found.length ? `${plural(found.length, "internal link")} of ${total} use generic anchor text such as "click here" or "read more", which tells users and search engines little about the target.` : `None of the ${total} internal links use generic anchor text.`,
    found.length ? "Use anchor text that describes the destination page." : "No action needed.", "Matched internal link text against a list of generic phrases.",
    found.slice(0, 25).map((f) => `"${f.text}" → ${f.href} (on ${f.page})`), Array.from(new Set(found.map((f) => f.page))));
}
