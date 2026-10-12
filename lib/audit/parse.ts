import * as cheerio from "cheerio";
import type { ImageRecord, LinkRecord, PageSummary } from "./types";

export interface JsonLdBlock {
  raw: string;
  data: unknown | null;
  error: string | null;
}

export interface ParsedPage {
  summary: PageSummary;
  links: LinkRecord[];
  images: ImageRecord[];
  jsonLd: JsonLdBlock[];
  microdataTypes: string[];
  text: string;
  mainText: string;
  firstParagraph: string;
  paragraphs: string[];
  /** Headings with the text of the content that directly follows them. */
  sections: { level: number; heading: string; followingText: string; followingTag: string | null }[];
  lists: { ordered: number; unordered: number };
  tables: number;
  timeElements: string[];
  metaAuthor: string | null;
  relAuthorLinks: number;
  bylineText: string | null;
  articleDates: { published: string | null; modified: string | null };
  mixedContent: string[];
  scriptCount: number;
  emailLinks: number;
  telLinks: number;
  addressElements: number;
  hasForms: boolean;
  siteName: string | null;
  /** Structural and accessibility signals detectable in static HTML. */
  a11y: A11ySignals;
  /** Distinct phone numbers (tel: links) and email addresses (mailto: links) on the page. */
  phones: string[];
  emails: string[];
  /** Raw <meta charset> / http-equiv declaration, if any. */
  declaredCharset: string | null;
}

export interface A11ySignals {
  hasMain: boolean;
  landmarks: string[];
  duplicateIds: string[];
  unlabeledControls: string[];
  unnamedButtons: number;
  emptyLinks: number;
  iframesWithoutTitle: number;
  positiveTabindex: number;
  skipLink: boolean;
  autoplayMedia: number;
  formControls: number;
  /** Suspicious markup patterns: nested forms, <a> inside <a>, inline event handlers count, deprecated tags. */
  suspicious: string[];
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const clean = (s: string | undefined | null) => (s || "").replace(/\s+/g, " ").trim();

function absolutize(href: string, base: URL): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export function registrableHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

export function parsePage(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const base = new URL($("base[href]").attr("href") || pageUrl, pageUrl);
  const pageHost = registrableHost(new URL(pageUrl).hostname);

  // Exclude <title> inside inline SVG, which is an accessibility label, not the page title.
  const titles = $("title")
    .toArray()
    .filter((el) => $(el).parents("svg").length === 0)
    .map((el) => clean($(el).text()));
  const metaDescriptions = $('meta[name="description" i]')
    .toArray()
    .map((el) => clean($(el).attr("content")));
  const robotsMeta = $('meta[name="robots" i], meta[name="googlebot" i]')
    .toArray()
    .map((el) => `${($(el).attr("name") || "").toLowerCase()}: ${clean($(el).attr("content")).toLowerCase()}`);
  const canonicals = $('link[rel~="canonical" i]')
    .toArray()
    .map((el) => $(el).attr("href") || "")
    .map((h) => absolutize(h, base) || h);

  const og: Record<string, string> = {};
  $('meta[property^="og:" i]').each((_, el) => {
    const k = ($(el).attr("property") || "").toLowerCase();
    if (k && !(k in og)) og[k] = clean($(el).attr("content"));
  });
  const tw: Record<string, string> = {};
  $('meta[name^="twitter:" i]').each((_, el) => {
    const k = ($(el).attr("name") || "").toLowerCase();
    if (k && !(k in tw)) tw[k] = clean($(el).attr("content"));
  });

  const jsonLd: JsonLdBlock[] = $('script[type="application/ld+json" i]')
    .toArray()
    .map((el) => {
      const raw = $(el).text().trim();
      try {
        return { raw, data: JSON.parse(raw), error: null };
      } catch (e) {
        return { raw, data: null, error: (e as Error).message };
      }
    });
  const microdataTypes = Array.from(
    new Set($("[itemtype]").toArray().map((el) => ($(el).attr("itemtype") || "").split("/").pop() || "")),
  ).filter(Boolean);

  const scriptCount = $("script[src], script:not([type]), script[type='module']").length;
  const metaAuthor = clean($('meta[name="author" i]').attr("content")) || null;
  const relAuthorLinks = $('a[rel~="author" i], link[rel~="author" i]').length;
  const byline = clean($('[class*="byline" i], [class*="author" i], [itemprop="author"]').first().text()) || null;
  const published =
    $('meta[property="article:published_time" i]').attr("content") || $("time[datetime]").first().attr("datetime") || null;
  const modified = $('meta[property="article:modified_time" i]').attr("content") || $('meta[property="og:updated_time" i]').attr("content") || null;
  const timeElements = $("time[datetime]").toArray().map((el) => $(el).attr("datetime") || "").slice(0, 20);

  // Mixed content: http:// subresources on an https page (active + passive).
  const mixedContent: string[] = [];
  if (pageUrl.startsWith("https:")) {
    $("script[src], link[rel~='stylesheet'][href], img[src], iframe[src], video[src], audio[src], source[src]").each((_, el) => {
      const v = $(el).attr("src") || $(el).attr("href") || "";
      if (/^http:\/\//i.test(v)) mixedContent.push(v);
    });
  }

  // Links
  const links: LinkRecord[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href") || "";
    const href = absolutize(raw, base);
    if (!href) return;
    const rel = clean($(el).attr("rel")).toLowerCase();
    const text = clean($(el).text()) || clean($(el).attr("aria-label")) || clean($(el).find("img").attr("alt"));
    const key = `${href}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    const internal = registrableHost(new URL(href).hostname) === pageHost;
    links.push({ href, text, rel, internal, nofollow: /\bnofollow\b/.test(rel) });
  });
  const emailLinks = $('a[href^="mailto:" i]').length;
  const telLinks = $('a[href^="tel:" i]').length;
  const addressElements = $("address").length;

  // Images (img + picture sources). Keep missing vs empty ALT distinct.
  const images: ImageRecord[] = [];
  const seenImg = new Set<string>();
  $("img").each((_, el) => {
    const $el = $(el);
    const srcRaw = $el.attr("src") || $el.attr("data-src") || $el.attr("data-lazy-src") || "";
    const src = srcRaw.startsWith("data:") ? null : absolutize(srcRaw, base);
    if (!src || seenImg.has(src)) return;
    seenImg.add(src);
    const altAttr = $el.attr("alt");
    const altState = altAttr === undefined ? "missing" : altAttr.trim() === "" ? "empty" : "present";
    const decorativeHint =
      $el.attr("role") === "presentation" || $el.attr("role") === "none" || $el.attr("aria-hidden") === "true";
    images.push({
      src,
      sourcePage: pageUrl,
      alt: altAttr === undefined ? null : altAttr,
      altState,
      decorativeHint,
      widthAttr: $el.attr("width") ?? null,
      heightAttr: $el.attr("height") ?? null,
      loading: $el.attr("loading") ?? null,
      hasSrcset: Boolean($el.attr("srcset") || $el.parent("picture").find("source[srcset]").length),
      inPicture: $el.parent("picture").length > 0,
    });
  });

  // Visible text (drop non-content elements on a copy).
  const $c = cheerio.load(html);
  $c("script, style, noscript, template, svg, iframe").remove();
  const text = clean($c("body").text());
  const mainEl = $c("main").first().length ? $c("main").first() : $c("article").first().length ? $c("article").first() : $c("body");
  const mainClone = mainEl.clone();
  mainClone.find("nav, header, footer, aside").remove();
  const mainText = clean(mainClone.text());

  const headings = $c("h1, h2, h3, h4, h5, h6")
    .toArray()
    .map((el) => ({ level: Number(el.tagName.slice(1)), text: clean($c(el).text()) }));

  const paragraphs = $c("p")
    .toArray()
    .map((el) => clean($c(el).text()))
    .filter((p) => p.length > 0);
  const firstParagraph = paragraphs.find((p) => p.split(" ").length >= 8) || "";

  const sections = $c("h1, h2, h3, h4")
    .toArray()
    .map((el) => {
      let next = $c(el).next();
      // skip empty wrappers
      for (let i = 0; i < 3 && next.length && !clean(next.text()); i++) next = next.next();
      return {
        level: Number(el.tagName.slice(1)),
        heading: clean($c(el).text()),
        followingText: clean(next.text()).slice(0, 2000),
        followingTag: next.length ? (next.get(0) as { tagName?: string }).tagName?.toLowerCase() || null : null,
      };
    });

  const wordCount = text ? text.split(" ").length : 0;
  const mainWordCount = mainText ? mainText.split(" ").length : 0;

  const hreflang = $('link[rel="alternate" i][hreflang]')
    .toArray()
    .map((el) => ({ lang: $(el).attr("hreflang") || "", href: absolutize($(el).attr("href") || "", base) || "" }));

  const summary: PageSummary = {
    title: titles[0] ?? null,
    titles,
    metaDescription: metaDescriptions[0] ?? null,
    metaDescriptions,
    robotsMeta,
    xRobotsTag: null,
    canonical: canonicals[0] ?? null,
    canonicals,
    lang: $("html").attr("lang") || null,
    charset: $("meta[charset]").attr("charset") || ($('meta[http-equiv="content-type" i]').attr("content")?.match(/charset=([^;]+)/i)?.[1] ?? null),
    viewport: $('meta[name="viewport" i]').attr("content") ?? null,
    openGraph: og,
    twitter: tw,
    headings,
    wordCount,
    mainWordCount,
    hreflang,
  };

  // ---- Accessibility and HTML structure (static HTML only; contrast and focus order need a browser).
  const idCounts = new Map<string, number>();
  $("[id]").each((_, el) => {
    const id = ($(el).attr("id") || "").trim();
    if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
  });
  const duplicateIds = Array.from(idCounts.entries()).filter(([, n]) => n > 1).map(([id, n]) => `#${id} (×${n})`);
  const labelFor = new Set($("label[for]").toArray().map((el) => $(el).attr("for") || ""));
  const unlabeledControls: string[] = [];
  const controls = $("input, select, textarea").toArray().filter((el) => {
    const t = ($(el).attr("type") || "").toLowerCase();
    return !["hidden", "submit", "button", "reset", "image"].includes(t);
  });
  for (const el of controls) {
    const $el = $(el);
    const id = $el.attr("id");
    const named =
      (id && labelFor.has(id)) || $el.parents("label").length > 0 || clean($el.attr("aria-label")) || $el.attr("aria-labelledby") || clean($el.attr("title"));
    if (!named) unlabeledControls.push(`<${el.tagName}${$el.attr("name") ? ` name="${clean($el.attr("name")).slice(0, 40)}"` : ""}${$el.attr("type") ? ` type="${$el.attr("type")}"` : ""}>`);
  }
  const unnamedButtons = $("button, [role='button'], input[type='submit'], input[type='button']").toArray().filter((el) => {
    const $el = $(el);
    if (el.tagName === "input") return !clean($el.attr("value")) && !clean($el.attr("aria-label"));
    return !clean($el.text()) && !clean($el.attr("aria-label")) && !$el.attr("aria-labelledby") && !clean($el.attr("title")) && !clean($el.find("img[alt]").attr("alt"));
  }).length;
  const emptyLinks = $("a[href]").toArray().filter((el) => {
    const $el = $(el);
    return !clean($el.text()) && !clean($el.attr("aria-label")) && !$el.attr("aria-labelledby") && !clean($el.attr("title")) && !clean($el.find("img[alt]").attr("alt"));
  }).length;
  const landmarks = Array.from(new Set($("main, nav, header, footer, aside, [role='main'], [role='navigation'], [role='banner'], [role='contentinfo']").toArray().map((el) => $(el).attr("role") || el.tagName)));
  const suspicious: string[] = [];
  if ($("form form").length) suspicious.push(`${$("form form").length} nested <form> element(s)`);
  if ($("a a").length) suspicious.push(`${$("a a").length} link(s) nested inside another link`);
  const deprecated = $("center, font, marquee, blink, frameset, frame").length;
  if (deprecated) suspicious.push(`${deprecated} deprecated presentational element(s) (center/font/marquee/frame)`);
  if ($("body").length === 0) suspicious.push("No <body> element in the source HTML");
  if ($("head > title").length === 0 && titles.length) suspicious.push("<title> appears outside <head>");
  const a11y: A11ySignals = {
    hasMain: $("main, [role='main']").length > 0,
    landmarks,
    duplicateIds: duplicateIds.slice(0, 30),
    unlabeledControls: unlabeledControls.slice(0, 30),
    unnamedButtons,
    emptyLinks,
    iframesWithoutTitle: $("iframe").toArray().filter((el) => !clean($(el).attr("title")) && !clean($(el).attr("aria-label"))).length,
    positiveTabindex: $("[tabindex]").toArray().filter((el) => Number($(el).attr("tabindex")) > 0).length,
    skipLink: $("a[href^='#']").toArray().slice(0, 5).some((el) => /skip|jump to|main content/i.test(clean($(el).text()))),
    autoplayMedia: $("video[autoplay]:not([muted]), audio[autoplay]").length,
    formControls: controls.length,
    suspicious,
  };
  const phones = Array.from(new Set($('a[href^="tel:" i]').toArray().map((el) => ($(el).attr("href") || "").slice(4).replace(/[^\d+]/g, "")).filter((x) => x.length >= 6))).slice(0, 20);
  const emails = Array.from(new Set($('a[href^="mailto:" i]').toArray().map((el) => safeDecode(($(el).attr("href") || "").slice(7).split("?")[0]).trim().toLowerCase()).filter((x) => x.includes("@")))).slice(0, 20);

  return {
    summary,
    links,
    images,
    jsonLd,
    microdataTypes,
    text,
    mainText,
    firstParagraph,
    paragraphs,
    sections,
    lists: { ordered: $c("ol").length, unordered: $c("ul").length },
    tables: $c("table").length,
    timeElements,
    metaAuthor,
    relAuthorLinks,
    bylineText: byline ? byline.slice(0, 200) : null,
    articleDates: { published, modified },
    mixedContent: Array.from(new Set(mixedContent)).slice(0, 50),
    scriptCount,
    emailLinks,
    telLinks,
    addressElements,
    hasForms: $("form").length > 0,
    siteName: og["og:site_name"] || null,
    a11y,
    phones,
    emails,
    declaredCharset: summary.charset,
  };
}
