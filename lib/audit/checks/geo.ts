import { builder, isArticleLike, truncate, type CheckContext } from "./context";
import type { CheckResult } from "../types";
import { orgNames } from "../structured-data";
import { KNOWN_CRAWLERS } from "../robots";

const SOCIAL = /(facebook|twitter|x\.com|instagram|linkedin|youtube|tiktok|pinterest|whatsapp|t\.me)\b/i;
const GENERIC_HEADINGS = /^(home|welcome|services|products|about|about us|contact|contact us|read more|learn more|menu|blog|news|more|overview|features)$/i;
const SEARCH_AGENTS = ["Googlebot", "Bingbot", "OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"];

export function geoChecks(ctx: CheckContext): CheckResult[] {
  const e = builder("geo", "Entity clarity", ctx.url);
  const c = builder("geo", "Content credibility", ctx.url);
  const a = builder("geo", "Crawl accessibility", ctx.url);
  const out: CheckResult[] = [];
  const p = ctx.parsed;
  const article = isArticleLike(ctx);

  const hasOrg = ctx.sd.types.some((t) => /Organization|Corporation|LocalBusiness|Store|Restaurant|ProfessionalService|Person/.test(t));
  out.push(e("geo-org-schema", "Organization / entity markup", hasOrg ? "pass" : "warning", "medium",
    hasOrg ? "Organization (or LocalBusiness/Person) structured data identifies the entity behind the site." : "No Organization, LocalBusiness or Person markup was found.",
    hasOrg ? "No action needed." : "Add Organization (or LocalBusiness) JSON-LD with name, url, logo and sameAs profiles, matching visible content.",
    "Checked JSON-LD types.", ctx.sd.types));

  const titleBrand = (p.summary.title || "").split(/\s[|–—-]\s|\s·\s/).map((x) => x.trim()).filter(Boolean);
  const sources: { source: string; name: string }[] = [];
  if (p.siteName) sources.push({ source: "og:site_name", name: p.siteName });
  orgNames(p.jsonLd).slice(0, 2).forEach((n) => sources.push({ source: "Structured data", name: n }));
  if (titleBrand.length > 1) sources.push({ source: "Title suffix", name: titleBrand[titleBrand.length - 1] });
  const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const consistent = sources.length >= 2 && sources.every((s) => normName(s.name).includes(normName(sources[0].name)) || normName(sources[0].name).includes(normName(s.name)));
  out.push(e("geo-brand-consistency", "Consistent brand name", sources.length < 2 ? "warning" : consistent ? "pass" : "warning", "low",
    sources.length < 2 ? "The brand name could be identified from fewer than two sources (og:site_name, structured data, title)." : consistent ? "The brand name is consistent across sources." : "The brand name differs between sources.",
    consistent ? "No action needed." : "Use one consistent business name in og:site_name, Organization markup and titles.",
    "Compared og:site_name, Organization/WebSite name and the title suffix.", sources.map((s) => `${s.source}: ${s.name}`),
    "Heuristic: abbreviations or taglines in a title can differ legitimately from the brand name."));

  const about = p.links.find((l) => l.internal && (/\babout\b|\bwho-we-are\b|\bour-story\b/i.test(new URL(l.href).pathname) || /^about/i.test(l.text)));
  out.push(e("geo-about-page", "About page", about ? "pass" : "warning", "low",
    about ? "The page links to an About page." : "No link to an About page was found on this page.",
    about ? "No action needed." : "Publish and link an About page describing who you are and what you do.", "Searched internal links for About URLs/text.", about ? [about.href] : []));

  const contactLink = p.links.find((l) => l.internal && (/contact/i.test(new URL(l.href).pathname) || /^contact/i.test(l.text)));
  const contactSignals = [contactLink ? `Contact link: ${contactLink.href}` : "", p.emailLinks ? `${p.emailLinks} mailto link(s)` : "", p.telLinks ? `${p.telLinks} tel link(s)` : "", p.addressElements ? `${p.addressElements} <address> element(s)` : ""].filter(Boolean);
  out.push(e("geo-contact", "Contact information", contactSignals.length ? "pass" : "warning", "medium",
    contactSignals.length ? "Contact information or a contact page is reachable from this page." : "No contact page link, email, phone or address was found.",
    contactSignals.length ? "No action needed." : "Make contact details easy to find (contact page, phone, email, address).", "Searched links and <address>.", contactSignals));

  const authorSignals = [p.metaAuthor ? `meta author: ${p.metaAuthor}` : "", p.relAuthorLinks ? `${p.relAuthorLinks} rel=author link(s)` : "", p.bylineText ? `byline: ${truncate(p.bylineText, 80)}` : "",
    ctx.sd.items.some((i) => i.properties.includes("author")) ? "structured data author" : ""].filter(Boolean);
  out.push(c("geo-author", "Author information", !article ? "not_applicable" : authorSignals.length ? "pass" : "warning", "medium",
    !article ? "The page is not article-like, so author attribution is not required." : authorSignals.length ? "Author information is present." : "This article-like page shows no author information.",
    article && !authorSignals.length ? "Name the author and link to a bio that shows relevant experience." : "No action needed.",
    "Checked meta author, rel=author, byline elements and structured data.", authorSignals));
  const dates = [p.articleDates.published ? `published: ${p.articleDates.published}` : "", p.articleDates.modified ? `modified: ${p.articleDates.modified}` : "", ...p.timeElements.slice(0, 3).map((t) => `<time>: ${t}`)].filter(Boolean);
  out.push(c("geo-dates", "Publication / update dates", !article ? "not_applicable" : dates.length ? "pass" : "warning", "low",
    !article ? "Dates are mainly relevant to articles; this page is not article-like." : dates.length ? "Publication or update dates are present." : "No publication or update date was found.",
    article && !dates.length ? "Show when the content was published and last reviewed." : "No action needed.", "Checked article:* meta, <time> elements.", dates));

  const external = p.links.filter((l) => !l.internal && !SOCIAL.test(new URL(l.href).hostname));
  const needsRefs = article || p.summary.mainWordCount > 600;
  out.push(c("geo-citations", "References to external sources", !needsRefs ? "not_applicable" : external.length ? "pass" : "warning", "low",
    !needsRefs ? "Short non-article page; external references are optional." : external.length ? `${external.length} link(s) to external (non-social) sources.` : "No links to external sources support the content.",
    needsRefs && !external.length ? "Cite credible primary sources for factual claims." : "No action needed.",
    "Counted external, non-social links in the HTML.", external.slice(0, 10).map((l) => l.href), "Link presence only; source credibility is not assessed."));

  const facts = (p.mainText.match(/\b\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?\s?(%|percent|years?|customers|clients|users|projects|km|kg|hours|days|\$|usd|€|£|₹)|\b(19|20)\d{2}\b/gi) || []).length;
  out.push(c("geo-specific-facts", "Specific, factual statements", p.summary.mainWordCount < 100 ? "not_applicable" : facts >= 3 ? "pass" : "warning", "low",
    `Found ${facts} specific figure(s) (numbers with units, percentages or years) in the main content.`,
    facts >= 3 ? "No action needed." : "Support claims with specific, verifiable details (figures, dates, named examples).",
    "Pattern match for quantified statements.", [], "Heuristic: counts figures, does not verify them."));

  const hs = p.summary.headings.filter((h) => h.level >= 2 && h.text);
  const descriptive = hs.filter((h) => h.text.split(/\s+/).length >= 3 && !GENERIC_HEADINGS.test(h.text));
  out.push(c("geo-descriptive-headings", "Descriptive headings", hs.length < 2 ? "not_applicable" : descriptive.length / hs.length >= 0.6 ? "pass" : "warning", "low",
    `${descriptive.length} of ${hs.length} subheadings are descriptive (3+ words, not generic labels).`,
    descriptive.length / Math.max(1, hs.length) >= 0.6 ? "No action needed." : "Use headings that say what the section covers.",
    "Word count and generic-label match on H2–H6.", hs.filter((h) => !descriptive.includes(h)).slice(0, 10).map((h) => h.text)));

  // Crawl accessibility for search/answer crawlers (training crawlers are reported but not scored).
  const disallowed = SEARCH_AGENTS.filter((ag) => ctx.robots.isAllowed(ctx.url, ag) === false);
  const evaluated = SEARCH_AGENTS.filter((ag) => ctx.robots.isAllowed(ctx.url, ag) !== null);
  out.push(a("geo-search-crawlers", "Search & answer crawlers allowed", evaluated.length === 0 ? "not_tested" : disallowed.length ? "warning" : "pass", "medium",
    evaluated.length === 0 ? "robots.txt rules could not be evaluated." : disallowed.length ? `robots.txt disallows ${disallowed.join(", ")} for this URL.` : "robots.txt allows the checked search and answer-engine crawlers for this URL.",
    disallowed.length ? "If you want visibility in those services, allow their search crawlers. Blocking is a legitimate business choice." : "No action needed.",
    `Evaluated robots.txt for ${SEARCH_AGENTS.join(", ")}.`, SEARCH_AGENTS.map((ag) => `${ag}: ${fmt(ctx.robots.isAllowed(ctx.url, ag))}`),
    "Reflects robots.txt only. Firewalls/CDN bot rules are not visible, operators differ in how they honour robots.txt, and access does not guarantee inclusion or citation."));

  const r = ctx.render;
  const staticWords = p.summary.wordCount;
  if (r.status === "ok" && r.renderedWordCount !== undefined) {
    const ratio = r.renderedWordCount > 0 ? staticWords / r.renderedWordCount : 1;
    const dependent = r.renderedWordCount > 100 && ratio < 0.5;
    out.push(a("geo-js-dependency", "Content available without JavaScript", dependent ? "fail" : "pass", "high",
      dependent ? `Only ${Math.round(ratio * 100)}% of the rendered text is present in the raw HTML. Crawlers that do not run JavaScript (many AI crawlers) may miss most content.` : `The raw HTML contains most of the rendered text (${staticWords} vs ${r.renderedWordCount} words).`,
      dependent ? "Server-render or pre-render important content." : "No action needed.",
      "Compared word counts of raw HTML and the Chromium-rendered page.", [`Raw HTML: ${staticWords} words`, `Rendered: ${r.renderedWordCount} words`]));
  } else {
    const suspicious = staticWords < 50 && p.scriptCount >= 3;
    out.push(a("geo-js-dependency", "Content available without JavaScript", suspicious ? "warning" : "not_tested", "high",
      suspicious ? `The raw HTML has only ${staticWords} words but ${p.scriptCount} scripts, which suggests content is rendered client-side.` : "Rendered comparison not run (browser rendering unavailable or disabled).",
      suspicious ? "Server-render important content; enable rendering in the audit to confirm." : "Enable JavaScript rendering to compare raw and rendered content.",
      "Raw HTML word count and script count.", [], "Without a rendered comparison this is an indicator, not a measurement."));
  }
  return out;
}

const fmt = (v: boolean | null) => (v === null ? "not evaluated" : v ? "allowed" : "disallowed");

export function aiCrawlerTable(ctx: CheckContext) {
  return KNOWN_CRAWLERS.map((k) => ({
    agent: k.agent,
    operator: k.operator,
    purpose: k.purpose,
    allowed: ctx.robots.isAllowed(ctx.url, k.agent),
    hasGroup: ctx.robots.hasGroupFor(k.agent),
  }));
}
