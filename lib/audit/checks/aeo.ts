import { builder, isHomepage, truncate, type CheckContext } from "./context";
import type { CheckResult } from "../types";
import { faqQuestions } from "../structured-data";

export const QUESTION_RE = /^(what|how|why|when|where|who|which|can|does|do|is|are|should|will|could|would)\b.*|.*\?$/i;
const wc = (s: string) => (s ? s.split(/\s+/).filter(Boolean).length : 0);

export function aeoChecks(ctx: CheckContext): CheckResult[] {
  const b = builder("aeo", "Answer readiness", ctx.url);
  const s = builder("aeo", "Structured data", ctx.url);
  const out: CheckResult[] = [];
  const sections = ctx.parsed.sections.filter((x) => x.level >= 2 && x.heading);
  const qSections = sections.filter((x) => QUESTION_RE.test(x.heading));
  const words = ctx.parsed.summary.mainWordCount;

  out.push(b("aeo-question-headings", "Question-based headings", qSections.length ? "pass" : words < 150 ? "not_applicable" : "warning", "low",
    qSections.length ? `${qSections.length} subheading(s) are phrased as questions.` : "No subheadings are phrased as questions. Where users ask questions about this topic, question headings make answers easy to locate.",
    qSections.length ? "No action needed." : "Where appropriate, phrase some section headings as the questions your audience asks.",
    "Matched H2–H4 text against interrogative words or a trailing question mark.", qSections.slice(0, 10).map((q) => q.heading),
    "Not every page needs question headings (for example product or contact pages)."));

  if (qSections.length) {
    const answered = qSections.filter((q) => {
      const n = wc(q.followingText);
      return (n >= 12 && n <= 120) || q.followingTag === "ul" || q.followingTag === "ol" || q.followingTag === "table";
    });
    const ratio = answered.length / qSections.length;
    out.push(b("aeo-direct-answers", "Direct answers under questions", ratio >= 0.5 ? "pass" : "warning", "medium",
      `${answered.length} of ${qSections.length} question heading(s) are immediately followed by a concise answer (12–120 words, a list or a table).`,
      ratio >= 0.5 ? "No action needed." : "Start each answer with a 1–3 sentence direct response, then add detail.",
      "Measured the first content block after each question heading.",
      qSections.filter((q) => !answered.includes(q)).slice(0, 10).map((q) => `"${truncate(q.heading, 80)}" → ${wc(q.followingText)} words (${q.followingTag || "none"})`),
      "Structural heuristic; it cannot judge whether the answer is correct or complete."));
  }

  const fp = ctx.parsed.firstParagraph;
  const fpw = wc(fp);
  out.push(b("aeo-summary", "Concise summary near the top", !fp ? "warning" : fpw <= 90 ? "pass" : "warning", "low",
    !fp ? "No introductory paragraph was found." : fpw <= 90 ? `The first paragraph is ${fpw} words, a good length for a quotable summary.` : `The first paragraph is ${fpw} words; long intros are harder to extract as an answer.`,
    fpw > 90 || !fp ? "Open with a short paragraph that states what the page offers or answers." : "No action needed.",
    "First <p> with at least 8 words.", fp ? [`"${truncate(fp, 200)}"`] : []));

  const defRe = /\b(is|are|refers to|means|is defined as)\s+(a|an|the)\b/i;
  const early = ctx.parsed.paragraphs.slice(0, 5).join(" ");
  const informational = qSections.length > 0 || /\b(guide|what is|how to|definition|explained)\b/i.test(ctx.parsed.summary.title || "");
  out.push(b("aeo-definitions", "Clear definitions", !informational ? "not_applicable" : defRe.test(early) ? "pass" : "warning", "low",
    !informational ? "The page does not look like informational content, so a definition check is not applicable." : defRe.test(early) ? "The opening paragraphs contain a definition-style sentence." : "No clear definition sentence (\"X is a …\") was found near the top.",
    "For informational topics, define the key concept plainly in one sentence early on.", "Pattern match on the first five paragraphs.", [], "Heuristic."));

  const procedural = sections.some((x) => /^how\b|step|guide|tutorial|install|setup|set up/i.test(x.heading)) || /how to/i.test(ctx.parsed.summary.title || "");
  const hasLists = ctx.parsed.lists.ordered > 0;
  out.push(b("aeo-steps", "Step-by-step formatting", !procedural ? "not_applicable" : hasLists ? "pass" : "warning", "low",
    !procedural ? "No procedural (how-to) content was detected." : hasLists ? `Found ${ctx.parsed.lists.ordered} ordered list(s) for procedural content.` : "Procedural headings were found but no ordered list of steps.",
    procedural && !hasLists ? "Present steps as a numbered list." : "No action needed.", "Detected how-to headings and counted <ol> elements."));

  const comparison = sections.some((x) => /\bvs\.?\b|versus|compar|alternatives|pricing|plans/i.test(x.heading));
  out.push(b("aeo-tables", "Comparison tables", !comparison ? "not_applicable" : ctx.parsed.tables ? "pass" : "warning", "low",
    !comparison ? "No comparison content detected." : ctx.parsed.tables ? `Found ${ctx.parsed.tables} table(s).` : "Comparison-style headings were found but no table.",
    comparison && !ctx.parsed.tables ? "Summarise comparisons in an HTML table." : "No action needed.", "Detected comparison headings and counted <table> elements."));

  const shallow = words > 300 && sections.filter((x) => x.level === 2).length < 2;
  out.push(b("aeo-sections", "Content broken into sections", words < 300 ? "not_applicable" : shallow ? "warning" : "pass", "low",
    shallow ? "This longer page has fewer than two H2 sections, which makes specific answers harder to find." : "Content is organised into sections.",
    shallow ? "Break long content into descriptive H2 sections." : "No action needed.", "Counted H2 sections on pages over 300 words."));

  // Structured data relevance (validity is scored under Technical SEO).
  const types = ctx.sd.types;
  const relevant = types.filter((t) => /^(FAQPage|QAPage|HowTo|Article|NewsArticle|BlogPosting|Product|BreadcrumbList|WebPage|Recipe|Event|Course)$/.test(t));
  out.push(s("aeo-schema", "Content-type structured data", relevant.length ? "pass" : "warning", "low",
    relevant.length ? `Found relevant types: ${relevant.join(", ")}.` : "No content-type structured data (Article, Product, BreadcrumbList, FAQPage, HowTo …) was found.",
    relevant.length ? "No action needed." : "Add schema.org markup that matches what the page actually is.",
    "Collected @type values from valid JSON-LD.", types, "Structured data helps machines classify content; it does not guarantee rich results."));

  const faqs = faqQuestions(ctx.parsed.jsonLd);
  if (faqs.length) {
    const text = ctx.parsed.text.toLowerCase();
    const invisible = faqs.filter((q) => !text.includes(q.toLowerCase().slice(0, 60)));
    out.push(s("aeo-faq-consistency", "FAQ schema matches visible content", invisible.length ? "fail" : "pass", "medium",
      invisible.length ? `${invisible.length} of ${faqs.length} FAQPage question(s) are not visible on the page. Markup must reflect visible content.` : `All ${faqs.length} FAQPage questions appear in the visible text.`,
      invisible.length ? "Show the same questions and answers on the page, or remove them from the markup." : "No action needed.",
      "Searched the visible text for each FAQPage question.", invisible.map((q) => truncate(q, 100)),
      "Google currently shows FAQ rich results only for a limited set of authoritative sites; markup still aids machine understanding."));
  } else if (qSections.length >= 3) {
    out.push(s("aeo-faq-opportunity", "FAQ markup opportunity", "info", "low",
      `The page has ${qSections.length} question headings but no FAQPage markup.`,
      "If this is a genuine FAQ section, FAQPage markup can describe it. It is optional and not a ranking requirement.", "Compared question headings with discovered types."));
  }
  if (!isHomepage(ctx.url)) {
    const hasCrumb = types.includes("BreadcrumbList");
    out.push(s("aeo-breadcrumbs", "Breadcrumb markup", hasCrumb ? "pass" : "warning", "low",
      hasCrumb ? "BreadcrumbList markup is present." : "No BreadcrumbList markup was found for this inner page.",
      hasCrumb ? "No action needed." : "Add visible breadcrumbs with BreadcrumbList markup to show where the page sits.", "Checked for BreadcrumbList type."));
  }
  return out;
}

/** Rule-based (non-AI) suggestions. Clearly labelled; never presented as demand data. */
export function aeoSuggestions(ctx: CheckContext): { questions: string[]; answerBlocks: string[]; note: string } {
  const topic = (ctx.input.primaryKeyword || ctx.parsed.summary.headings.find((h) => h.level === 1)?.text || "").trim();
  const questions = topic
    ? [`What is ${topic}?`, `How does ${topic} work?`, `How much does ${topic} cost?`, `What are the benefits of ${topic}?`, `How do I choose the right ${topic}?`]
    : [];
  const unanswered = ctx.parsed.sections
    .filter((x) => x.level >= 2 && QUESTION_RE.test(x.heading) && wc(x.followingText) > 120)
    .slice(0, 5)
    .map((x) => `Add a 40–60 word direct answer at the start of the section "${truncate(x.heading, 80)}".`);
  return {
    questions,
    answerBlocks: unanswered,
    note: "Rule-based templates derived from your keyword or H1. They are not search demand data and need human review before use.",
  };
}
