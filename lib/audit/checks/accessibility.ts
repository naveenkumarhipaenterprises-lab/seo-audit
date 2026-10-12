import { builder, type CheckContext } from "./context";
import type { CheckResult } from "../types";

const LIMIT = "Static HTML checks only. Colour contrast, focus visibility, keyboard traps and screen-reader behaviour need a browser and manual testing; passing these checks is not a WCAG conformance claim.";

/** Accessibility and HTML-structure signals that can be detected reliably in the served HTML. */
export function accessibilityChecks(ctx: CheckContext): CheckResult[] {
  const a = ctx.parsed.a11y;
  const b = builder("accessibility", "Accessibility & HTML structure", ctx.url);
  const out: CheckResult[] = [];
  out.push(b("a11y-main-landmark", "Main content landmark", a.hasMain ? "pass" : "warning", "medium",
    a.hasMain ? "The page marks its main content with <main> (or role=\"main\")." : "No <main> element or role=\"main\" was found. Screen-reader users rely on landmarks to jump to the main content, and it also helps parsers separate content from navigation.",
    a.hasMain ? "No action needed." : "Wrap the primary content in a single <main> element.", "Searched the HTML for <main> and role=\"main\".",
    a.landmarks.length ? [`Landmarks found: ${a.landmarks.join(", ")}`] : [], LIMIT));
  out.push(b("a11y-duplicate-ids", "Duplicate element IDs", a.duplicateIds.length ? "warning" : "pass", "low",
    a.duplicateIds.length ? `${a.duplicateIds.length} id value(s) are used on more than one element. Duplicate IDs break label/aria references and in-page links.` : "No duplicate id attributes were found.",
    a.duplicateIds.length ? "Make every id unique within the page." : "No action needed.", "Counted id attributes in the HTML.", a.duplicateIds));
  out.push(b("a11y-form-labels", "Form fields have labels", a.formControls === 0 ? "not_applicable" : a.unlabeledControls.length ? "fail" : "pass", "high",
    a.formControls === 0 ? "The page has no form fields." : a.unlabeledControls.length ? `${a.unlabeledControls.length} of ${a.formControls} form field(s) have no associated label, aria-label, aria-labelledby or title.` : `All ${a.formControls} form field(s) have an accessible label.`,
    a.unlabeledControls.length ? "Associate each field with a visible <label for> (preferred) or an aria-label." : "No action needed.",
    "Checked input/select/textarea elements (excluding hidden and button types) for label associations.", a.unlabeledControls,
    "Placeholder text is not counted as a label."));
  out.push(b("a11y-button-names", "Buttons have accessible names", a.unnamedButtons ? "fail" : "pass", "medium",
    a.unnamedButtons ? `${a.unnamedButtons} button(s) have no text, aria-label, aria-labelledby or title, so assistive technology announces them without a purpose.` : "Every button has an accessible name in the HTML.",
    a.unnamedButtons ? "Add visible text or an aria-label to icon-only buttons." : "No action needed.", "Checked <button>, role=button and input buttons for a name.", [],
    "Names added by JavaScript after load are not seen."));
  out.push(b("a11y-iframe-titles", "Iframes have titles", a.iframesWithoutTitle ? "warning" : "pass", "low",
    a.iframesWithoutTitle ? `${a.iframesWithoutTitle} iframe(s) have no title attribute.` : "All iframes (if any) have a title.",
    a.iframesWithoutTitle ? "Add a short descriptive title to each iframe." : "No action needed.", "Checked <iframe> elements for title or aria-label."));
  out.push(b("a11y-tabindex", "No positive tabindex", a.positiveTabindex ? "warning" : "pass", "low",
    a.positiveTabindex ? `${a.positiveTabindex} element(s) use a positive tabindex, which overrides the natural keyboard order.` : "No positive tabindex values were found.",
    a.positiveTabindex ? "Use tabindex=\"0\" or DOM order instead of positive values." : "No action needed.", "Read tabindex attributes."));
  out.push(b("a11y-autoplay", "No unmuted autoplay media", a.autoplayMedia ? "warning" : "pass", "low",
    a.autoplayMedia ? `${a.autoplayMedia} audio/video element(s) autoplay without being muted.` : "No unmuted autoplaying media was found.",
    a.autoplayMedia ? "Do not autoplay sound; provide controls." : "No action needed.", "Checked <video autoplay> without muted and <audio autoplay>."));
  out.push(b("a11y-skip-link", "Skip to content link", a.skipLink ? "pass" : "info", "low",
    a.skipLink ? "A skip link was found near the start of the page." : "No \"skip to content\" link was detected among the first in-page links. It helps keyboard users bypass repeated navigation.",
    a.skipLink ? "No action needed." : "Consider adding a skip link as the first focusable element.", "Looked for an in-page link with skip/jump text among the first five # links."));
  out.push(b("html-suspicious-patterns", "Invalid or suspicious HTML patterns", a.suspicious.length ? "warning" : "pass", "low",
    a.suspicious.length ? "Patterns were found that browsers repair inconsistently and that can confuse parsers." : "No nested forms, nested links or deprecated presentational tags were found.",
    a.suspicious.length ? "Fix the markup patterns listed in the evidence." : "No action needed.", "Pattern checks on the parsed HTML (not a full W3C validation).", a.suspicious,
    "This is not a complete HTML validation."));
  return out;
}

/** External Lighthouse accessibility score, shown for reference only (not scored, to avoid double counting). */
export function lighthouseAccessibilityCheck(ctx: Pick<CheckContext, "url" | "performance">): CheckResult[] {
  const lh = ctx.performance.filter((p) => p.status === "ok" && p.categories?.accessibility != null);
  if (!lh.length) return [];
  const b = builder("accessibility", "Accessibility & HTML structure", ctx.url);
  return [{ ...b("lighthouse-accessibility", "Lighthouse accessibility score", "info", "low",
    lh.map((p) => `${p.strategy}: ${p.categories!.accessibility}/100`).join(", ") + " (automated Lighthouse audit).",
    "Review the failing Lighthouse accessibility audits in PageSpeed Insights.", "Google PageSpeed Insights, Lighthouse accessibility category.", [],
    "Shown for reference and not included in this tool's accessibility score, to avoid counting the same issues twice."), source: "external" }];
}
