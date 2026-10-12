import { builder, truncate, type CheckContext } from "./context";
import type { CheckResult, KeywordSummary } from "../types";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
function countPhrase(text: string, phrase: string): number {
  if (!phrase) return 0;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return (norm(text).match(new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "gu")) || []).length;
}
const contains = (text: string, phrase: string) => countPhrase(text, norm(phrase)) > 0;

export function analyzeKeyword(ctx: CheckContext): KeywordSummary | null {
  const kw = (ctx.input.primaryKeyword || "").trim();
  if (!kw) return null;
  const p = ctx.parsed.summary;
  const k = norm(kw);
  const slug = decodeURIComponent(new URL(ctx.url).pathname).replace(/[-_/]+/g, " ");
  const first100 = ctx.parsed.mainText.split(" ").slice(0, 100).join(" ");
  const h1 = p.headings.filter((h) => h.level === 1).map((h) => h.text).join(" | ");
  const subheads = p.headings.filter((h) => h.level >= 2 && h.level <= 3).map((h) => h.text).join(" | ");
  const occurrences = countPhrase(ctx.parsed.mainText, k);
  const words = Math.max(1, ctx.parsed.summary.mainWordCount);
  const kwWords = k.split(/\s+/).length;
  return {
    primary: kw,
    secondary: ctx.input.secondaryKeywords || [],
    placements: [
      { location: "Title", found: contains(p.title || "", k) },
      { location: "Meta description", found: contains(p.metaDescription || "", k) },
      { location: "H1", found: contains(h1, k) },
      { location: "H2/H3 headings", found: contains(subheads, k) },
      { location: "URL", found: contains(slug, k) },
      { location: "First 100 words", found: contains(first100, k) },
      { location: "Main content", found: occurrences > 0, detail: `${occurrences} occurrence(s)` },
    ],
    occurrences,
    density: Math.round(((occurrences * kwWords) / words) * 10000) / 100,
    secondaryResults: (ctx.input.secondaryKeywords || []).map((s) => ({
      keyword: s,
      inBody: contains(ctx.parsed.mainText, s),
      inHeadings: contains(p.headings.map((h) => h.text).join(" | "), s),
      occurrences: countPhrase(ctx.parsed.mainText, norm(s)),
    })),
    unavailable: ["Search volume", "Keyword difficulty", "Ranking position", "Backlink authority"],
  };
}

export function contentChecks(ctx: CheckContext, kw: KeywordSummary | null): CheckResult[] {
  const b = builder("content", "Content", ctx.url);
  const k = builder("content", "Keyword placement", ctx.url);
  const out: CheckResult[] = [];
  const words = ctx.parsed.summary.mainWordCount;
  out.push(b("content-length", "Content length", words < 50 ? "fail" : words < 300 ? "warning" : "pass", words < 50 ? "medium" : "low",
    `The main content contains about ${words} words.${words < 300 ? " Short pages can struggle to fully answer a query." : ""}`,
    words < 300 ? "Add genuinely useful detail if the page's purpose calls for it. There is no fixed word count requirement." : "No action needed.",
    "Word count of <main>/<article> (or <body>) excluding nav, header, footer, scripts and styles.", [`${words} words`],
    "Word count is a rough proxy; quality and intent match matter more than length."));
  out.push(...qualityChecks(ctx));
  out.push(b("duplicate-content", "Duplicate content across pages", "not_tested", "medium", "Comparing content between pages requires a multi-page crawl. Run a Full Site Audit to check this.", "Run a Full Site Audit.", "Requires a multi-page crawl."));
  if (!kw) {
    out.push(k("keyword-provided", "Target keyword analysis", "not_tested", "medium", "No primary keyword was entered, so keyword placement was not analysed.", "Enter a primary keyword when starting an audit.", "User input."));
    return out;
  }
  const at = (loc: string) => kw.placements.find((p) => p.location === loc)!;
  const place = (id: string, loc: string, sev: "high" | "medium" | "low", rec: string) =>
    k(id, `Keyword in ${loc.toLowerCase()}`, at(loc).found ? "pass" : "warning", sev,
      at(loc).found ? `"${kw.primary}" appears in the ${loc.toLowerCase()}.` : `"${kw.primary}" does not appear in the ${loc.toLowerCase()}.`,
      at(loc).found ? "No action needed." : rec, "Case- and accent-insensitive whole-phrase match.", [],
      "Exact-phrase matching; close variants and synonyms also count for search engines.");
  out.push(place("kw-title", "Title", "medium", "Include the topic naturally in the title if it reflects the page."));
  out.push(place("kw-description", "Meta description", "low", "Mention the topic in the description where it reads naturally."));
  out.push(place("kw-h1", "H1", "medium", "Reflect the topic in the main heading."));
  out.push(place("kw-headings", "H2/H3 headings", "low", "Use the topic or close variants in at least one subheading where relevant."));
  out.push(place("kw-url", "URL", "low", "A short descriptive slug helps users; do not change established URLs only for this."));
  out.push(place("kw-intro", "First 100 words", "low", "State the topic early so readers know they are in the right place."));
  const stuffing = kw.density > 3 && kw.occurrences > 5;
  out.push(k("kw-density", "Keyword usage", kw.occurrences === 0 ? "warning" : stuffing ? "warning" : "pass", "medium",
    kw.occurrences === 0 ? `"${kw.primary}" does not appear in the main content.` : `"${kw.primary}" appears ${kw.occurrences} time(s) (~${kw.density}% of words).${stuffing ? " This may read as keyword stuffing." : ""}`,
    stuffing ? "Write naturally and use variants; repetition does not help." : kw.occurrences === 0 ? "Cover the topic explicitly in the body text." : "No action needed.",
    "Phrase frequency in main content.", [], "Density is shown for awareness only; there is no ideal percentage."));
  if (kw.secondaryResults.length) {
    const missing = kw.secondaryResults.filter((s) => !s.inBody);
    out.push(k("kw-secondary", "Secondary keyword coverage", missing.length === kw.secondaryResults.length ? "warning" : "pass", "low",
      `${kw.secondaryResults.length - missing.length} of ${kw.secondaryResults.length} secondary keyword(s) appear in the main content.`,
      missing.length ? `Consider whether these subtopics belong on this page: ${missing.map((m) => m.keyword).join(", ")}.` : "No action needed.",
      "Whole-phrase match in main content.", kw.secondaryResults.map((s) => `${s.keyword}: ${s.occurrences} in body${s.inHeadings ? ", in headings" : ""}`)));
  }
  const kwLinks = ctx.parsed.links.filter((l) => l.internal && contains(l.text, kw.primary));
  out.push(k("kw-internal-links", "Internal link opportunities", "info", "low",
    kwLinks.length ? `${kwLinks.length} internal link(s) use anchor text containing the keyword.` : "No internal links on this page use the keyword in their anchor text.",
    "Link related pages with descriptive anchor text where it helps readers.", "Matched internal link anchor text.",
    kwLinks.slice(0, 10).map((l) => `"${truncate(l.text, 60)}" → ${l.href}`)));
  return out;
}

const STOP = new Set("a an and are as at be but by for from has have how i in is it its of on or our that the this to was we what when where which who why will with you your".split(" "));
const tokens = (t: string) => norm(t).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length || 1);
}

/** Flesch reading ease (English only). Returns null when there is too little text to judge. */
export function fleschReadingEase(text: string): number | null {
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().split(/\s+/).length >= 3);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length < 100 || sentences.length < 3) return null;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return Math.round((206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syl / words.length)) * 10) / 10;
}

/** Most repeated 3-word phrases (stop words excluded), used as a keyword-stuffing indicator. */
export function repeatedPhrases(text: string, min = 6): { phrase: string; count: number }[] {
  const w = tokens(text);
  const m = new Map<string, number>();
  for (let i = 0; i + 3 <= w.length; i++) {
    const k = w.slice(i, i + 3).join(" ");
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m.entries()).filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([phrase, count]) => ({ phrase, count }));
}

function qualityChecks(ctx: CheckContext): CheckResult[] {
  const out: CheckResult[] = [];
  const b = (id: string, title: string, status: CheckResult["status"], sev: CheckResult["severity"], expl: string, rec: string, det: string, ev: string[] = [], lim?: string): CheckResult =>
    ({ ...builder("content", "Content quality", ctx.url)(id, title, status, sev, expl, rec, det, ev, lim), source: "assessment" });
  const p = ctx.parsed.summary;
  const h1 = p.headings.find((h) => h.level === 1)?.text || "";
  if (p.title && h1) {
    const brand = new Set(tokens(ctx.parsed.siteName || ""));
    const a = new Set(tokens(p.title).filter((t) => !brand.has(t)));
    const c = new Set(tokens(h1).filter((t) => !brand.has(t)));
    const shared = Array.from(a).filter((t) => c.has(t));
    const overlap = a.size && c.size ? shared.length / Math.min(a.size, c.size) : 0;
    out.push(b("topic-title-h1", "Title and H1 describe the same topic", overlap >= 0.3 ? "pass" : "warning", "low",
      overlap >= 0.3 ? "The title and main heading share key terms, so the page topic is consistent." : "The title and the H1 share few meaningful words, which can make the main topic less clear.",
      overlap >= 0.3 ? "No action needed." : "Make sure the title and H1 both state the page's main topic (they need not be identical).",
      "Overlap of non-stop-word terms between <title> and the first <h1>, excluding the site name.", [`Title: "${truncate(p.title, 90)}"`, `H1: "${truncate(h1, 90)}"`, `Shared terms: ${shared.join(", ") || "none"}`],
      "A heuristic; synonyms are not recognised."));
  }
  const english = !p.lang || /^en\b/i.test(p.lang);
  const fre = english ? fleschReadingEase(ctx.parsed.mainText) : null;
  out.push(b("readability", "Readability", !english ? "not_applicable" : fre === null ? "not_tested" : fre >= 50 ? "pass" : fre >= 30 ? "warning" : "warning", "low",
    !english ? `Readability scoring is only calibrated for English; the page language is "${p.lang}".` : fre === null ? "There was too little running text to estimate readability." : `Flesch reading ease is ${fre} (${fre >= 60 ? "plain English" : fre >= 50 ? "fairly difficult" : fre >= 30 ? "difficult" : "very difficult"}).`,
    fre !== null && fre < 50 ? "Shorter sentences and plainer words make content easier to scan and quote. Technical audiences may justify harder text." : "No action needed.",
    "Flesch reading ease over the main content (sentence length and syllables per word).", [], "A formula-based estimate; it ignores meaning, layout and audience."));
  const reps = repeatedPhrases(ctx.parsed.mainText);
  const words = Math.max(1, p.mainWordCount);
  const heavy = reps.filter((r) => (r.count * 3) / words > 0.02);
  out.push(b("repeated-phrases", "Repeated phrases", p.mainWordCount < 150 ? "not_applicable" : heavy.length ? "warning" : "pass", "low",
    heavy.length ? "Some three-word phrases repeat unusually often, which can read as keyword stuffing." : "No phrase repeats unusually often in the main content.",
    heavy.length ? "Vary wording and remove repetition that does not help readers." : "No action needed.",
    "Counted repeated three-word phrases (stop words removed) in the main content.", reps.map((r) => `"${r.phrase}" × ${r.count}`), "Lists and product grids can repeat phrases legitimately."));
  return out;
}
