import { describe, expect, it } from "vitest";
import { parsePage } from "@/lib/audit/parse";
import { analyzeStructuredData } from "@/lib/audit/structured-data";
import { fixture } from "../helpers";

const U = "https://www.example-healthy.com/spice-blends";

describe("metadata extraction", () => {
  const p = parsePage(fixture("healthy.html"), U);
  it("extracts title, description, canonical and OG", () => {
    expect(p.summary.title).toBe("Organic Spice Blends for Home Cooks | Acme Spices");
    expect(p.summary.metaDescription).toMatch(/^Hand-ground organic/);
    expect(p.summary.canonical).toBe("https://www.example-healthy.com/spice-blends");
    expect(p.summary.openGraph["og:site_name"]).toBe("Acme Spices");
    expect(p.summary.lang).toBe("en");
    expect(p.summary.viewport).toContain("device-width");
  });
  it("handles missing title and description", () => {
    const m = parsePage(fixture("missing-title-desc.html"), "https://x.example.com/");
    expect(m.summary.title).toBeNull();
    expect(m.summary.metaDescription).toBeNull();
  });
  it("ignores <title> inside inline SVG", () => {
    const m = parsePage('<html><head></head><body><svg><title>icon</title></svg></body></html>', "https://x.example.com/");
    expect(m.summary.title).toBeNull();
  });
});

describe("heading extraction", () => {
  it("captures levels, text and empty headings in order", () => {
    const p = parsePage(fixture("multiple-headings.html"), "https://x.example.com/");
    expect(p.summary.headings.map((h) => h.level)).toEqual([1, 1, 3, 2, 2, 2]);
    expect(p.summary.headings[3].text).toBe("");
  });
  it("records the text following each section heading", () => {
    const p = parsePage(fixture("healthy.html"), U);
    const s = p.sections.find((x) => x.heading.startsWith("How to store"));
    expect(s?.followingTag).toBe("ol");
  });
});

describe("canonical and robots directives", () => {
  it("resolves relative canonicals and keeps every declared canonical", () => {
    const p = parsePage(fixture("canonical-mismatch.html"), "https://www.example-healthy.com/products?page=2");
    expect(p.summary.canonicals).toEqual(["https://www.example-healthy.com/canonical-target", "https://www.example-healthy.com/other"]);
    const rel = parsePage('<link rel="canonical" href="/a">', "https://x.example.com/b/c");
    expect(rel.summary.canonical).toBe("https://x.example.com/a");
  });
  it("reads meta robots", () => {
    const p = parsePage(fixture("noindex.html"), "https://x.example.com/");
    expect(p.summary.robotsMeta).toEqual(["robots: noindex, nofollow"]);
  });
});

describe("image and ALT detection", () => {
  it("distinguishes missing, empty and present ALT and resolves URLs", () => {
    const p = parsePage(fixture("missing-alt.html"), "https://x.example.com/dir/");
    expect(p.images.map((i) => i.altState)).toEqual(["missing", "empty", "present", "present"]);
    expect(p.images[0].src).toBe("https://x.example.com/a.png");
    expect(p.images[3].decorativeHint).toBe(true);
  });
  it("detects width/height, lazy loading and srcset", () => {
    const p = parsePage(fixture("healthy.html"), U);
    expect(p.images[0]).toMatchObject({ widthAttr: "800", heightAttr: "600", hasSrcset: true });
    expect(p.images[2].loading).toBe("lazy");
  });
  it("skips data: URIs", () => {
    const p = parsePage('<img src="data:image/png;base64,AAAA" alt="x">', "https://x.example.com/");
    expect(p.images).toHaveLength(0);
  });
});

describe("links", () => {
  it("classifies internal vs external and ignores non-http schemes", () => {
    const p = parsePage('<a href="/a">A</a><a href="https://www.x.example.com/b">B</a><a href="https://other.org">O</a><a href="javascript:void(0)">J</a><a href="mailto:a@b.c">M</a>', "https://x.example.com/");
    expect(p.links.map((l) => [l.href, l.internal])).toEqual([["https://x.example.com/a", true], ["https://www.x.example.com/b", true], ["https://other.org/", false]]);
  });
});

describe("structured data", () => {
  it("flattens @graph and validates properties", () => {
    const p = parsePage(fixture("healthy.html"), U);
    const sd = analyzeStructuredData(p.jsonLd, p.microdataTypes);
    expect(sd.types.sort()).toEqual(["Article", "BreadcrumbList", "Organization"]);
    expect(sd.invalidBlocks).toHaveLength(0);
    expect(sd.issues).toHaveLength(0);
  });
  it("reports malformed JSON-LD and missing properties", () => {
    const p = parsePage(fixture("malformed-jsonld.html"), "https://x.example.com/");
    const sd = analyzeStructuredData(p.jsonLd, p.microdataTypes);
    expect(sd.invalidBlocks).toHaveLength(1);
    expect(sd.issues.map((i) => i.message)).toEqual(expect.arrayContaining(["Question 1 is missing acceptedAnswer.text.", "Product is missing name (required).", "Product needs one of offers, review or aggregateRating."]));
  });
});
