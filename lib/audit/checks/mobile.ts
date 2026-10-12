import { builder, type CheckContext } from "./context";
import type { CheckResult } from "../types";

const LIMIT = "Basic automated checks at three viewport sizes; this is not a complete mobile usability certification.";

export function mobileChecks(ctx: CheckContext): CheckResult[] {
  const b = builder("mobile", "Mobile & responsive", ctx.url);
  const out: CheckResult[] = [];
  const vp = ctx.parsed.summary.viewport;
  const deviceWidth = /width\s*=\s*device-width/i.test(vp || "");
  out.push(b("mobile-viewport", "Viewport meta tag", !vp ? "fail" : deviceWidth ? "pass" : "warning", "high",
    !vp ? "No viewport meta tag. Mobile browsers will render the page at desktop width and scale it down." : deviceWidth ? `Viewport is configured: "${vp}".` : `Viewport is set but not to width=device-width: "${vp}".`,
    !vp || !deviceWidth ? 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' : "No action needed.",
    "Parsed meta viewport in the HTML."));
  if (vp) {
    const noZoom = /user-scalable\s*=\s*(no|0)/i.test(vp) || (/maximum-scale\s*=\s*([\d.]+)/i.exec(vp)?.[1] && Number(/maximum-scale\s*=\s*([\d.]+)/i.exec(vp)![1]) < 2);
    out.push(b("mobile-zoom", "Pinch-zoom allowed", noZoom ? "warning" : "pass", "medium",
      noZoom ? "The viewport disables or limits zooming, which hurts accessibility for low-vision users." : "Users can zoom the page.",
      noZoom ? "Remove user-scalable=no and maximum-scale limits." : "No action needed.", "Parsed viewport directives."));
  }
  const r = ctx.render;
  const notRendered = (id: string, title: string) =>
    b(id, title, "not_tested", "medium", r.error || "Rendered checks were not run.", "Enable JavaScript rendering for this audit.", "Requires headless Chromium.", [], LIMIT);
  if (r.status !== "ok" || !r.viewports.length) {
    out.push(notRendered("mobile-overflow", "No horizontal scrolling"), notRendered("mobile-text-size", "Readable text size"), notRendered("mobile-tap-targets", "Tap target size"));
  } else {
    const small = r.viewports.filter((v) => v.width < 1000);
    const overflow = small.filter((v) => v.horizontalOverflow);
    out.push(b("mobile-overflow", "No horizontal scrolling", overflow.length ? "fail" : "pass", "high",
      overflow.length ? `The page is wider than the screen at ${overflow.map((v) => `${v.width}px`).join(" and ")}, causing horizontal scrolling.` : "No horizontal overflow at mobile and tablet widths.",
      overflow.length ? "Find elements wider than the viewport (fixed widths, large images, tables) and make them responsive." : "No action needed.",
      "Compared document scrollWidth with the viewport width in headless Chromium.",
      r.viewports.map((v) => `${v.name} ${v.width}px: scrollWidth ${v.scrollWidth}px, ${v.clippedElements} element(s) beyond edge, ${v.imagesWiderThanViewport} wide image(s)`), LIMIT));
    const m = r.viewports.find((v) => v.name === "Mobile")!;
    out.push(b("mobile-text-size", "Readable text size", m.smallTextRatio > 0.2 ? "warning" : "pass", "medium",
      `${Math.round(m.smallTextRatio * 100)}% of text elements render below 12px at 375px width.`,
      m.smallTextRatio > 0.2 ? "Use a base font size of at least 16px and avoid tiny text." : "No action needed.",
      "Computed font-size of visible text elements.", [], LIMIT));
    const ratio = m.tapTargetsChecked ? m.smallTapTargets / m.tapTargetsChecked : 0;
    out.push(b("mobile-tap-targets", "Tap target size", m.tapTargetsChecked === 0 ? "not_applicable" : ratio > 0.25 ? "warning" : "pass", "medium",
      `${m.smallTapTargets} of ${m.tapTargetsChecked} interactive elements are smaller than 24×24px at 375px width.`,
      ratio > 0.25 ? "Make buttons and links at least 24×24px (44px is more comfortable) with spacing." : "No action needed.",
      "Measured bounding boxes of links, buttons and inputs (inline text links exempt, per WCAG 2.5.8).", [], LIMIT));
  }
  const imgs = ctx.images;
  if (imgs.length >= 3) {
    const responsive = imgs.filter((i) => i.hasSrcset).length;
    out.push(b("mobile-responsive-images", "Responsive images", responsive / imgs.length < 0.25 ? "warning" : "pass", "low",
      `${responsive} of ${imgs.length} images use srcset or <picture>.`,
      responsive / imgs.length < 0.25 ? "Serve multiple image sizes with srcset/sizes so phones download smaller files." : "No action needed.",
      "Checked srcset and <picture> sources.", [], "Images resized by an image CDN via URL parameters are not detected."));
  }
  return out;
}
