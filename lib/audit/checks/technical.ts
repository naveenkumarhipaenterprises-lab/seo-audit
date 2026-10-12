import { builder, isHomepage, truncate, type CheckContext } from "./context";
import type { CheckResult } from "../types";
import { normalizeForCompare } from "../sitemap";

const LIMIT_TITLE = "Length guidance is approximate: search engines truncate by pixel width and may rewrite titles and snippets. This is not a ranking penalty.";

export function technicalChecks(ctx: CheckContext): CheckResult[] {
  const out: CheckResult[] = [];
  const p = ctx.parsed.summary;
  const http = builder("technical", "HTTP & security", ctx.url);
  const meta = builder("onpage", "Metadata", ctx.url);
  const head = builder("onpage", "Headings", ctx.url);
  const idx = builder("technical", "Indexability", ctx.url);
  const sdb = builder("technical", "Structured data", ctx.url);
  const lnk = builder("technical", "Links", ctx.url);

  // ---- HTTP & security
  const ok = ctx.status >= 200 && ctx.status < 300;
  out.push(http("http-status", "HTTP status code", ok ? "pass" : "fail", "critical",
    ok ? `The page returned HTTP ${ctx.status}.` : `The page returned HTTP ${ctx.status}; non-2xx pages are generally not indexed.`,
    ok ? "No action needed." : "Make sure the URL returns 200 for users and crawlers, or redirect it to the correct page.",
    "Final response status after following redirects.", [`HTTP ${ctx.status}`]));
  const hops = ctx.redirects.length;
  out.push(http("redirect-chain", "Redirects", hops === 0 ? "not_applicable" : hops === 1 ? "pass" : "warning", "medium",
    hops === 0 ? "The URL did not redirect." : hops === 1 ? "The URL redirects once to its final destination." : `The URL passes through ${hops} redirects before the final page. Chains slow users down and waste crawl budget.`,
    hops > 1 ? "Link and redirect directly to the final URL in a single hop." : "No action needed.",
    "Followed redirects manually and recorded each hop.",
    ctx.redirects.map((r) => `${r.status}: ${r.url} → ${r.location}`)));
  const https = ctx.url.startsWith("https:");
  out.push(http("https", "HTTPS", https ? "pass" : "fail", "high",
    https ? "The final URL is served over HTTPS." : "The final URL is served over plain HTTP.",
    https ? "No action needed." : "Serve the site over HTTPS and 301-redirect HTTP URLs to HTTPS.",
    "Protocol of the final URL.", [ctx.url]));
  out.push(http("mixed-content", "Mixed content", !https ? "not_applicable" : ctx.parsed.mixedContent.length ? "fail" : "pass", "medium",
    ctx.parsed.mixedContent.length ? `${ctx.parsed.mixedContent.length} subresource(s) are referenced over http:// on an HTTPS page. Browsers block or warn on these.` : "No http:// subresources were found in the HTML.",
    ctx.parsed.mixedContent.length ? "Reference these resources over https:// (or protocol-relative to an HTTPS host)." : "No action needed.",
    "Scanned src/href attributes of scripts, stylesheets, images, iframes and media in the HTML.",
    ctx.parsed.mixedContent, "Resources injected by JavaScript are not covered by this HTML check."));
  if (ctx.htmlTruncated) {
    out.push(http("html-truncated", "HTML size limit reached", "info", "low",
      "The HTML exceeded this tool's download limit, so only the first part of the page was analysed.",
      "Very large HTML documents are slow to download and parse; consider reducing page weight.", "Byte cap on the HTML download."));
  }

  // ---- Metadata
  const title = p.title;
  out.push(meta("title-present", "Title tag", title ? "pass" : "fail", "high",
    title ? "The page has a <title>." : "The page has no <title> or it is empty. Titles are a primary signal for what a page is about and are shown in search results.",
    title ? "No action needed." : "Add a unique, descriptive <title> that states the page topic and brand.",
    "Parsed <title> elements in the HTML (excluding SVG titles).", title ? [`"${truncate(title, 200)}"`] : []));
  if (title) {
    const len = title.length;
    const good = len >= 30 && len <= 60;
    out.push(meta("title-length", "Title length", good ? "pass" : "warning", "low",
      `The title is ${len} characters. Around 30–60 characters usually displays fully in results.`,
      good ? "No action needed." : len < 30 ? "Consider a more descriptive title." : "Consider front-loading the key topic; the end may be truncated.",
      "Character count of the first <title>.", [`${len} characters`], LIMIT_TITLE));
  }
  if (p.titles.length > 1) {
    out.push(meta("title-multiple", "Multiple title tags", "warning", "medium",
      `The HTML contains ${p.titles.length} <title> elements; search engines may pick any of them.`,
      "Keep exactly one <title> in the <head>.", "Counted <title> elements.", p.titles.map((t) => `"${truncate(t)}"`)));
  }
  const desc = p.metaDescription;
  out.push(meta("meta-description", "Meta description", desc ? "pass" : "warning", "medium",
    desc ? "The page has a meta description." : "No meta description was found. Search engines will generate a snippet from page content instead.",
    desc ? "No action needed." : "Write a concise summary (about 70–160 characters) that matches the page content.",
    'Parsed <meta name="description">.', desc ? [`"${truncate(desc, 200)}"`] : [],
    "Meta descriptions are not a ranking factor; they influence the search snippet and click-through."));
  if (desc) {
    const len = desc.length;
    const good = len >= 70 && len <= 160;
    out.push(meta("meta-description-length", "Meta description length", good ? "pass" : "warning", "low",
      `The description is ${len} characters.`, good ? "No action needed." : len < 70 ? "Consider adding more useful detail." : "Consider shortening; long descriptions are truncated.",
      "Character count.", [`${len} characters`], LIMIT_TITLE));
  }
  if (p.metaDescriptions.length > 1) {
    out.push(meta("meta-description-multiple", "Multiple meta descriptions", "warning", "low",
      `${p.metaDescriptions.length} meta description tags were found.`, "Keep a single meta description.", "Counted tags.",
      p.metaDescriptions.map((d) => `"${truncate(d)}"`)));
  }
  out.push(meta("duplicate-metadata-sitewide", "Duplicate titles/descriptions across pages", "not_tested", "medium",
    "Detecting duplicates requires crawling multiple pages. Run a Full Site Audit to check this.", "Run a Full Site Audit.", "Requires a multi-page crawl."));
  const og = p.openGraph;
  const ogHave = ["og:title", "og:description", "og:image"].filter((k) => og[k]);
  const twCard = p.twitter["twitter:card"];
  out.push(meta("social-metadata", "Open Graph & social metadata", ogHave.length === 3 ? "pass" : "warning", "low",
    ogHave.length === 3 ? "og:title, og:description and og:image are present." : `Missing Open Graph tags: ${["og:title", "og:description", "og:image"].filter((k) => !og[k]).join(", ")}. Shared links may render without a proper preview.`,
    ogHave.length === 3 ? "No action needed." : "Add the missing Open Graph tags (and optionally twitter:card).",
    "Parsed og:* and twitter:* meta tags.",
    [...Object.entries(og).slice(0, 8).map(([k, v]) => `${k}: ${truncate(v, 100)}`), twCard ? `twitter:card: ${twCard}` : "twitter:card: not set"]));
  out.push(meta("html-lang", "Language attribute", p.lang ? "pass" : "warning", "low",
    p.lang ? `The <html> element declares lang="${p.lang}".` : "The <html> element has no lang attribute.",
    p.lang ? "No action needed." : 'Add lang (for example lang="en") to <html> for accessibility and language detection.',
    "Read the lang attribute of <html>.", p.lang ? [p.lang] : []));

  // ---- Headings
  const h1s = p.headings.filter((h) => h.level === 1);
  out.push(head("h1-present", "H1 heading", h1s.length ? "pass" : "fail", "high",
    h1s.length ? `Found ${h1s.length} H1.` : "The page has no H1. A clear main heading helps users and crawlers understand the topic.",
    h1s.length ? "No action needed." : "Add one H1 that describes the page's main topic.",
    "Parsed <h1> elements in the static HTML.", h1s.map((h) => `H1: "${truncate(h.text || "(empty)")}"`)));
  if (h1s.length > 1) {
    out.push(head("h1-multiple", "Multiple H1 headings", "warning", "low",
      `The page has ${h1s.length} H1 elements. This is valid HTML and not a Google violation, but one clear H1 usually communicates the topic best.`,
      "Consider using a single H1 and H2s for sections.", "Counted <h1> elements.", h1s.map((h) => `"${truncate(h.text)}"`)));
  }
  const empty = p.headings.filter((h) => !h.text);
  out.push(head("headings-empty", "Empty headings", empty.length ? "warning" : p.headings.length ? "pass" : "not_applicable", "low",
    empty.length ? `${empty.length} heading element(s) contain no text.` : "No empty headings found.",
    empty.length ? "Remove empty heading tags or give them meaningful text." : "No action needed.",
    "Checked text content of h1–h6.", empty.map((h) => `Empty H${h.level}`)));
  const skips: string[] = [];
  for (let i = 1; i < p.headings.length; i++) {
    const prev = p.headings[i - 1].level;
    const cur = p.headings[i].level;
    if (cur > prev + 1) skips.push(`H${prev} → H${cur} before "${truncate(p.headings[i].text, 60)}"`);
  }
  out.push(head("heading-hierarchy", "Heading hierarchy", p.headings.length < 2 ? "not_applicable" : skips.length ? "warning" : "pass", "low",
    skips.length ? `Heading levels are skipped ${skips.length} time(s). Logical nesting helps assistive technology and content parsing.` : "Heading levels nest without skipping.",
    skips.length ? "Use sequential heading levels (H2 under H1, H3 under H2)." : "No action needed.",
    "Compared consecutive heading levels in document order.", skips));
  const counts = new Map<string, number>();
  p.headings.filter((h) => h.level >= 2 && h.text).forEach((h) => counts.set(h.text.toLowerCase(), (counts.get(h.text.toLowerCase()) || 0) + 1));
  const dups = Array.from(counts.entries()).filter(([, n]) => n > 1);
  out.push(head("headings-duplicate", "Duplicate headings", dups.length ? "warning" : p.headings.length ? "pass" : "not_applicable", "low",
    dups.length ? `${dups.length} heading text(s) repeat on the page.` : "No repeated subheadings.",
    dups.length ? "Make section headings distinct so each describes its content." : "No action needed.",
    "Compared H2–H6 text.", dups.map(([t, n]) => `"${truncate(t, 80)}" ×${n}`)));

  // ---- Indexability
  const r = ctx.robots.summary;
  out.push(idx("robots-txt", "robots.txt", r.status === "ok" ? "pass" : r.status === "missing" ? "warning" : r.status === "error" ? "fail" : "not_tested", r.status === "error" ? "high" : "low",
    r.status === "ok" ? "robots.txt was found and parsed." : r.status === "missing" ? `robots.txt returned HTTP ${r.httpStatus}. Crawlers treat this as no restrictions.` : r.error || "robots.txt could not be fetched.",
    r.status === "ok" ? "No action needed." : r.status === "missing" ? "Optional: add a robots.txt that lists your sitemap." : "Make sure /robots.txt returns 200 (or 404) quickly and reliably.",
    "Fetched /robots.txt on the final origin.", [r.url, r.httpStatus ? `HTTP ${r.httpStatus}` : "No response"]));
  out.push(idx("robots-allows-page", "Allowed by robots.txt (Googlebot)", r.allowedForGooglebot === null ? "not_tested" : r.allowedForGooglebot ? "pass" : "fail", "critical",
    r.allowedForGooglebot === false ? "robots.txt disallows Googlebot from crawling this URL." : r.allowedForGooglebot ? "robots.txt allows Googlebot to crawl this URL." : "robots.txt rules could not be evaluated.",
    r.allowedForGooglebot === false ? "Remove or narrow the Disallow rule if this page should appear in search." : "No action needed.",
    "Evaluated robots.txt rules for the Googlebot token against the final URL."));
  const directives = [...p.robotsMeta, ctx.headers["x-robots-tag"] ? `x-robots-tag: ${ctx.headers["x-robots-tag"].toLowerCase()}` : ""].filter(Boolean);
  const noindex = directives.some((d) => /\bnoindex\b|\bnone\b/.test(d.split(":").slice(1).join(":")));
  const nofollow = directives.some((d) => /\bnofollow\b/.test(d.split(":").slice(1).join(":")));
  out.push(idx("noindex", "Noindex directive", noindex ? "fail" : "pass", "critical",
    noindex ? "A noindex directive was found. Search engines will drop this page from their index (this may be intentional)." : "No noindex directive in meta robots or the X-Robots-Tag header.",
    noindex ? "Remove noindex if the page should be indexed." : "No action needed.",
    "Parsed meta robots/googlebot tags and the X-Robots-Tag HTTP header.", directives));
  if (nofollow) {
    out.push(idx("nofollow-directive", "Page-level nofollow", "warning", "medium",
      "A page-level nofollow directive tells crawlers not to follow any links on this page.", "Remove nofollow unless intentional.",
      "Parsed robots directives.", directives));
  }
  const canon = p.canonical;
  const distinctCanon = Array.from(new Set(p.canonicals));
  out.push(idx("canonical-present", "Canonical tag", canon ? "pass" : "warning", "medium",
    canon ? "A canonical URL is declared." : "No canonical tag was found. Search engines will choose a canonical themselves, which can split signals between URL variants.",
    canon ? "No action needed." : "Add a self-referencing <link rel=\"canonical\"> with the absolute preferred URL.",
    'Parsed <link rel="canonical">.', canon ? [canon] : []));
  if (distinctCanon.length > 1) {
    out.push(idx("canonical-multiple", "Conflicting canonical tags", "fail", "high",
      `${distinctCanon.length} different canonical URLs are declared. Google may ignore all of them.`, "Declare exactly one canonical URL.",
      "Compared canonical link elements.", distinctCanon));
  }
  if (canon) {
    const self = normalizeForCompare(canon) === normalizeForCompare(ctx.url);
    const probe = ctx.canonicalProbe;
    const targetBad = probe && (probe.status === null || probe.status >= 300);
    const status = targetBad ? "fail" : self ? "pass" : "warning";
    out.push(idx("canonical-target", "Canonical destination", status, targetBad ? "high" : "medium",
      targetBad ? `The canonical URL does not return a 200 response (${probe?.status ? `HTTP ${probe.status}` : probe?.error || "no response"}).`
        : self ? "The canonical tag points to this URL (self-referencing)."
        : "The canonical tag points to a different URL. This page is asking search engines to index the other URL instead (canonical mismatch).",
      targetBad ? "Point the canonical at a live, indexable 200 URL." : self ? "No action needed." : "Confirm this is intended; otherwise make the canonical self-referencing.",
      "Compared the normalised canonical with the final URL and requested the canonical target (without following redirects as success).",
      [`Canonical: ${canon}`, `Final URL: ${ctx.url}`, probe ? `Target status: ${probe.status ?? probe.error}` : "Target not requested"]));
    if (noindex && !self) {
      out.push(idx("canonical-noindex-conflict", "Canonical / noindex conflict", "warning", "medium",
        "The page is noindex and also canonicalises to another URL. These are mixed signals.", "Use one approach: either canonicalise to the preferred URL or noindex, not both.",
        "Combined canonical and robots directive results."));
    }
  }
  const sm = ctx.sitemap;
  out.push(idx("sitemap-found", "XML sitemap", sm.status === "found" ? "pass" : sm.status === "not_tested" ? "not_tested" : "warning", "medium",
    sm.status === "found" ? `Found ${sm.checked.filter((c) => c.type !== "error").length} sitemap file(s) with ${sm.totalUrls} URL(s) read.` : "No valid XML sitemap was found in robots.txt or at /sitemap.xml.",
    sm.status === "found" ? "No action needed." : "Publish an XML sitemap and reference it from robots.txt.",
    "Read Sitemap: lines from robots.txt, falling back to /sitemap.xml.", sm.checked.map((c) => `${c.url} — ${c.type}${c.urlCount ? ` (${c.urlCount})` : ""}${c.error ? ` — ${c.error}` : ""}`),
    sm.truncated ? `Only the first ${sm.checked.length} sitemap files were read.` : undefined));
  const invalid = sm.checked.filter((c) => c.type === "invalid");
  if (invalid.length) {
    out.push(idx("sitemap-valid", "Sitemap validity", "fail", "medium", "A sitemap file does not have a valid <urlset> or <sitemapindex> root.", "Fix the sitemap XML structure.", "Parsed sitemap XML.", invalid.map((c) => c.url)));
  }
  out.push(idx("sitemap-includes-url", "URL listed in sitemap", sm.includesAuditedUrl === null ? "not_tested" : sm.includesAuditedUrl ? "pass" : "warning", "low",
    sm.includesAuditedUrl === null ? "Could not determine sitemap inclusion (no sitemap, or not all sitemap files were read)." : sm.includesAuditedUrl ? "The audited URL is listed in the sitemap." : "The audited URL is not listed in any sitemap that was read.",
    sm.includesAuditedUrl === false ? "Include canonical, indexable URLs in your sitemap." : "No action needed.", "Compared normalised <loc> values with the final URL."));
  out.push(idx("google-index-status", "Google indexing status", "not_tested", "high",
    "Not verified through Search Console. A 200 status, crawl permission, sitemap entry or self-canonical does not prove a page is indexed.",
    "Connect Google Search Console in Settings and enable it for the audit to use the URL Inspection API for a verified property.",
    "Requires the Search Console URL Inspection API, subject to Google's quotas and property authorization."));
  if (p.hreflang.length) {
    const bad = p.hreflang.filter((h) => !h.href || !/^([a-z]{2,3}(-[a-z0-9]{2,4})?|x-default)$/i.test(h.lang));
    out.push(idx("hreflang", "hreflang annotations", bad.length ? "warning" : "pass", "low",
      bad.length ? `${bad.length} hreflang annotation(s) have an invalid language code or URL.` : `${p.hreflang.length} hreflang annotation(s) look well-formed.`,
      bad.length ? "Use ISO 639-1 language (and optional ISO 3166-1 region) codes with absolute URLs." : "No action needed.",
      "Parsed link rel=alternate hreflang.", (bad.length ? bad : p.hreflang).map((h) => `${h.lang} → ${h.href}`),
      "Return links on the alternate pages are not verified in a single-page audit."));
  }

  // ---- Structured data (validity only; relevance is scored under AEO/GEO)
  const sd = ctx.sd;
  out.push(sdb("jsonld-syntax", "JSON-LD syntax", sd.jsonLdBlocks === 0 ? "not_applicable" : sd.invalidBlocks.length ? "fail" : "pass", "medium",
    sd.jsonLdBlocks === 0 ? "No JSON-LD blocks were found." : sd.invalidBlocks.length ? `${sd.invalidBlocks.length} of ${sd.jsonLdBlocks} JSON-LD block(s) are not valid JSON and will be ignored by search engines.` : `${sd.jsonLdBlocks} JSON-LD block(s) parse correctly.`,
    sd.invalidBlocks.length ? "Fix the JSON syntax (trailing commas, unescaped quotes, comments)." : "No action needed.",
    "JSON.parse of each application/ld+json script.", sd.invalidBlocks.map((b) => `Block ${b.index}: ${b.error} — ${b.snippet}`)));
  if (sd.jsonLdBlocks > sd.invalidBlocks.length) {
    out.push(sdb("structured-data-properties", "Structured data properties", sd.issues.length ? "warning" : "pass", "medium",
      sd.issues.length ? `${sd.issues.length} missing or invalid property issue(s) in supported types.` : `Supported types (${sd.types.join(", ") || "none"}) include the checked properties.`,
      sd.issues.length ? "Add the missing properties. Structured data must describe content visible on the page." : "No action needed.",
      "Checked Organization, LocalBusiness, Article, Product, FAQPage, BreadcrumbList and HowTo items for Google-documented properties.",
      sd.issues.map((i) => `${i.type}: ${i.message}`),
      "Focused property check, not a full schema.org validation. Valid markup does not guarantee a rich result."));
  }

  // ---- Links
  const internal = ctx.parsed.links.filter((l) => l.internal);
  out.push(lnk("internal-links", "Internal links", internal.length >= 3 ? "pass" : internal.length ? "warning" : "fail", internal.length ? "low" : "medium",
    `Found ${internal.length} unique internal link(s) and ${ctx.parsed.links.length - internal.length} external link(s) in the HTML.`,
    internal.length >= 3 ? "No action needed." : "Link to related pages so users and crawlers can discover them.",
    "Parsed <a href> elements in the static HTML.", internal.slice(0, 10).map((l) => l.href),
    "Links added only by JavaScript are not counted."));
  const checkedInternal = ctx.linksChecked.filter((l) => l.internal);
  const brokenInt = checkedInternal.filter((l) => (l.error && !l.unverified) || (l.status ?? 0) >= 400);
  const unverifiedInt = checkedInternal.filter((l) => l.unverified);
  out.push(lnk("broken-internal-links", "Broken internal links", checkedInternal.length === 0 ? "not_tested" : brokenInt.length ? "fail" : "pass", "high",
    checkedInternal.length === 0 ? "No internal links were checked." : brokenInt.length ? `${brokenInt.length} of ${checkedInternal.length} checked internal link(s) are broken or unreachable.` : `All ${checkedInternal.length} checked internal links responded successfully.`,
    brokenInt.length ? "Fix or remove links that return errors." : "No action needed.",
    "Requested each link (HEAD, falling back to GET) through the SSRF-protected fetcher.",
    brokenInt.map((l) => `${l.status ?? l.error}: ${l.href}`),
    [internal.length > checkedInternal.length ? `Checked ${checkedInternal.length} of ${internal.length} internal links (limit).` : "",
      unverifiedInt.length ? `${unverifiedInt.length} link(s) could not be verified (timeout or connection refused) and are not counted as broken: ${unverifiedInt.slice(0, 5).map((l) => l.href).join(", ")}` : ""].filter(Boolean).join(" ") || undefined));
  if (ctx.input.checkExternalLinks) {
    const checkedExt = ctx.linksChecked.filter((l) => !l.internal);
    const brokenExt = checkedExt.filter((l) => (l.status ?? 0) >= 400 && l.status !== 403 && l.status !== 429);
    out.push(lnk("broken-external-links", "Broken external links", checkedExt.length === 0 ? "not_tested" : brokenExt.length ? "warning" : "pass", "low",
      checkedExt.length === 0 ? "No external links were checked." : brokenExt.length ? `${brokenExt.length} external link(s) returned an error status.` : `Checked ${checkedExt.length} external link(s) without errors.`,
      brokenExt.length ? "Update or remove dead external references." : "No action needed.", "Requested external links with strict limits.",
      brokenExt.map((l) => `${l.status}: ${l.href}`), "Many sites block automated requests (403/429); those are not counted as broken."));
  }
  const emptyAnchors = ctx.parsed.links.filter((l) => !l.text);
  out.push(lnk("empty-anchor-text", "Links without anchor text", emptyAnchors.length ? "warning" : "pass", "low",
    emptyAnchors.length ? `${emptyAnchors.length} link(s) have no text, aria-label or image alt.` : "All links have accessible text.",
    emptyAnchors.length ? "Give every link descriptive text or an aria-label." : "No action needed.", "Checked link text, aria-label and child image alt.",
    emptyAnchors.slice(0, 15).map((l) => l.href)));
  const intNofollow = internal.filter((l) => l.nofollow);
  if (intNofollow.length) {
    out.push(lnk("internal-nofollow", "Nofollow internal links", "warning", "low",
      `${intNofollow.length} internal link(s) use rel="nofollow", which stops crawlers following them.`, "Remove nofollow from internal links unless intentional.",
      "Parsed rel attributes.", intNofollow.slice(0, 15).map((l) => l.href)));
  }
  if (!isHomepage(ctx.url)) {
    // Orphan detection needs a crawl graph; report honestly.
    out.push(lnk("orphan-pages", "Orphan page candidates", "not_tested", "low", "Orphan detection needs a multi-page crawl plus sitemap comparison. Run a Full Site Audit to check this.", "Run a Full Site Audit.", "Requires a multi-page crawl."));
  }
  return out;
}
