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
  out.push(b("duplicate-content", "Duplicate content across pages", "not_tested", "medium", "Comparing content between pages requires a multi-page crawl (Phase 2).", "—", "Requires multi-page crawl."));
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
