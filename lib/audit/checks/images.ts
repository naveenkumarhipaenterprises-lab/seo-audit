import { builder, truncate, type CheckContext } from "./context";
import type { CheckResult } from "../types";

const FILENAME_ALT = /^(img|image|photo|picture|pic|dsc|screenshot|untitled)?[-_ ]?\d*(\.(jpe?g|png|gif|webp|avif|svg))?$/i;

const assess = (c: CheckResult): CheckResult => ({ ...c, source: "assessment" });

export function imageChecks(ctx: CheckContext): CheckResult[] {
  const b = builder("images", "Images", ctx.url);
  const imgs = ctx.images;
  if (!imgs.length) {
    return [b("images-found", "Images on page", "not_applicable", "low", "No <img> elements were found in the HTML.", "—", "Parsed <img> elements.", [],
      "Images added only by JavaScript or CSS backgrounds are not detected in the static HTML.")];
  }
  const out: CheckResult[] = [];
  const multi = new Set(imgs.map((i) => i.sourcePage)).size > 1;
  const where = (i: (typeof imgs)[number]) => (multi ? `${i.src} (on ${i.sourcePage})` : i.src);
  const missing = imgs.filter((i) => i.altState === "missing");
  out.push(b("img-alt-missing", "Missing ALT attributes", missing.length ? "fail" : "pass", "medium",
    missing.length ? `${missing.length} of ${imgs.length} image(s) have no alt attribute at all. Screen readers may announce the file name and search engines lose context.` : "Every image has an alt attribute.",
    missing.length ? 'Add descriptive alt text to informative images, or alt="" to purely decorative ones.' : "No action needed.",
    "Checked presence of the alt attribute (missing is distinguished from intentionally empty).", missing.map(where)));
  const emptyAlt = imgs.filter((i) => i.altState === "empty");
  if (emptyAlt.length) {
    out.push(b("img-alt-empty", "Empty ALT (decorative)", "info", "low",
      `${emptyAlt.length} image(s) use alt="", which correctly marks decorative images. Review that none of them convey information.`,
      "Keep alt=\"\" for decorative images; add text where the image is meaningful.", "Checked for alt attributes with empty values.",
      emptyAlt.map((i) => i.src), "Whether an image is decorative depends on context and needs human review."));
  }
  const poorAlt = imgs.filter((i) => i.altState === "present" && (FILENAME_ALT.test((i.alt || "").trim()) || (i.alt || "").length > 150));
  out.push(assess(b("img-alt-quality", "ALT text quality", poorAlt.length ? "warning" : "pass", "low",
    poorAlt.length ? `${poorAlt.length} ALT text(s) look like file names/generic words or are very long.` : "ALT texts do not look like file names or placeholders.",
    poorAlt.length ? "Describe what the image shows in a short phrase." : "No action needed.", "Pattern match on ALT values.",
    poorAlt.map((i) => `"${truncate(i.alt || "", 60)}" — ${i.src}`), "Heuristic; cannot judge whether the description is accurate.")));
  const altGroups = new Map<string, Set<string>>();
  for (const i of imgs) if (i.altState === "present") {
    const k = (i.alt || "").trim().toLowerCase();
    altGroups.set(k, (altGroups.get(k) || new Set()).add(i.src));
  }
  const repeated = Array.from(altGroups.entries()).filter(([, v]) => v.size >= 3);
  out.push(assess(b("img-alt-repetitive", "Repetitive ALT text", repeated.length ? "warning" : "pass", "low",
    repeated.length ? `${repeated.length} ALT text value(s) are reused on three or more different images, so they probably do not describe each image.` : "ALT texts are not reused across many different images.",
    repeated.length ? "Describe each informative image individually; use alt=\"\" for decorative repeats." : "No action needed.",
    "Grouped identical ALT values across different image URLs.", repeated.slice(0, 10).map(([alt, v]) => `"${truncate(alt, 60)}" on ${v.size} images`))));
  const fileName = (u: string) => {
    try {
      return decodeURIComponent(new URL(u).pathname.split("/").pop() || "");
    } catch {
      return "";
    }
  };
  const opaque = imgs.filter((i) => {
    const f = fileName(i.src).replace(/\.[a-z0-9]+$/i, "");
    return f && (/^(img|dsc|dcim|pxl|image|photo|screenshot|untitled)[-_ ]?\d+/i.test(f) || /^[a-f0-9-]{16,}$/i.test(f) || /^\d+$/.test(f));
  });
  out.push(assess(b("img-filenames", "Descriptive file names", opaque.length ? "info" : "pass", "low",
    opaque.length ? `${opaque.length} image file name(s) are camera defaults, hashes or numbers (e.g. IMG_1234.jpg). Descriptive names are a minor relevance signal for image search.` : "Image file names are not camera defaults or opaque hashes.",
    opaque.length ? "Use short descriptive file names for new important images. Renaming existing images is rarely worth breaking URLs." : "No action needed.",
    "Pattern match on image file names.", opaque.slice(0, 15).map((i) => fileName(i.src)), "CDNs often rewrite file names; this is a weak signal.")));
  const probed = imgs.filter((i) => i.probe);
  if (!ctx.imagesProbed || !probed.length) {
    out.push(b("img-broken", "Broken images", "not_tested", "high", "Image URLs were not requested.", "—", "Image probing disabled or skipped."));
  } else {
    const broken = probed.filter((i) => (i.probe!.error && !i.probe!.unverified) || (i.probe!.status ?? 0) >= 400);
    const unverified = probed.filter((i) => i.probe!.unverified);
    out.push(b("img-broken", "Broken images", broken.length ? "fail" : "pass", "high",
      broken.length ? `${broken.length} of ${probed.length} checked image(s) failed to load.` : `All ${probed.length} checked images responded successfully.`,
      broken.length ? "Fix or remove broken image URLs." : "No action needed.",
      "Requested the first 64 KB of each image through the SSRF-protected fetcher.",
      broken.map((i) => `${i.probe!.status ?? i.probe!.error}: ${i.src}`),
      [imgs.length > probed.length ? `Checked ${probed.length} of ${imgs.length} images (limit).` : "",
        unverified.length ? `${unverified.length} image(s) could not be verified (timeout or connection refused) and are not counted as broken.` : ""].filter(Boolean).join(" ") || undefined));
    const big = probed.filter((i) => (i.probe!.bytes ?? 0) > 500 * 1024);
    out.push(b("img-oversized", "Large image files", big.length ? "warning" : "pass", "medium",
      big.length ? `${big.length} image(s) are larger than 500 KB.` : "No checked image exceeds 500 KB.",
      big.length ? "Compress and resize large images to the size they are displayed at." : "No action needed.",
      "Content-Length / Content-Range header of each image response.",
      big.map((i) => `${Math.round((i.probe!.bytes || 0) / 1024)} KB — ${i.src}`), "Images without a size header could not be measured."));
    const legacy = probed.filter((i) => /jpe?g|png|gif|bmp/i.test(i.probe!.format || i.probe!.contentType || "") && (i.probe!.bytes ?? 0) > 100 * 1024 && !i.inPicture);
    out.push(b("img-modern-format", "Modern image formats", legacy.length ? "warning" : "pass", "low",
      legacy.length ? `${legacy.length} JPEG/PNG/GIF image(s) over 100 KB could likely be smaller as WebP or AVIF.` : "No large legacy-format images found among checked images.",
      legacy.length ? "Serve WebP/AVIF (for example with <picture> or an image CDN), keeping a fallback where needed." : "No action needed.",
      "Format from the image header / Content-Type and response size.", legacy.map((i) => `${i.probe!.format || i.probe!.contentType} ${Math.round((i.probe!.bytes || 0) / 1024)} KB — ${i.src}`)));
  }
  const noDims = imgs.filter((i) => !i.widthAttr || !i.heightAttr);
  out.push(b("img-dimensions", "Explicit image dimensions", noDims.length ? "warning" : "pass", "low",
    noDims.length ? `${noDims.length} image(s) lack width and height attributes, which can cause layout shift (CLS).` : "All images declare width and height.",
    noDims.length ? "Add width and height attributes (or CSS aspect-ratio) so space is reserved before load." : "No action needed.",
    "Checked width/height attributes on <img>.", noDims.map((i) => i.src), "Sizes set purely in CSS are not detected by this HTML check."));
  const lazy = imgs.filter((i) => i.loading === "lazy");
  const firstLazy = imgs[0]?.loading === "lazy";
  const lazyStatus = firstLazy ? "warning" : imgs.length > 5 && lazy.length === 0 ? "warning" : "pass";
  out.push(b("img-lazy-loading", "Lazy loading", lazyStatus, "low",
    firstLazy ? "The first image in the HTML is lazy-loaded; if it is the main above-the-fold image this can delay LCP."
      : imgs.length > 5 && lazy.length === 0 ? `None of the ${imgs.length} images use loading="lazy".` : `${lazy.length} of ${imgs.length} images use loading="lazy".`,
    firstLazy ? "Do not lazy-load the main hero image." : lazyStatus === "warning" ? 'Add loading="lazy" to below-the-fold images.' : "No action needed.",
    "Checked loading attributes.", [], "Native lazy loading only; JavaScript lazy-loading libraries are not detected."));
  return out;
}
