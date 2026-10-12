import { describe, expect, it } from "vitest";
import { runAudit, AuditFailedError, AuditAbortedError } from "@/lib/audit/run";
import type { AuditEvent, AuditRecord } from "@/lib/audit/types";
import { stagesForMode } from "@/lib/audit/types";
import { baseInput, fixture, fixtureFetcher, PNG, testDeps, type Route } from "../helpers";

const H = "https://www.example-healthy.com";
const robots: Route = { body: "User-agent: *\nAllow: /\nUser-agent: GPTBot\nDisallow: /\nSitemap: https://www.example-healthy.com/sitemap.xml\n", headers: { "content-type": "text/plain" } };
const sitemap: Route = { body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${H}/spice-blends</loc></url><url><loc>${H}/about</loc></url></urlset>`, headers: { "content-type": "application/xml" } };

async function audit(routes: Record<string, Route>, url: string, extra = {}, depOverrides = {}) {
  const events: AuditEvent[] = [];
  const fetcher = fixtureFetcher(routes);
  const deps = testDeps(fetcher, depOverrides);
  const rec = await runAudit(baseInput(url, extra), deps, (e) => events.push(e));
  return { rec, events, fetcher, deps };
}
const check = (r: AuditRecord, id: string) => r.checks.find((c) => c.id === id);

describe("audit pipeline on fixtures", () => {
  const healthyRoutes: Record<string, Route> = {
    [`${H}/robots.txt`]: robots,
    [`${H}/sitemap.xml`]: sitemap,
    [`${H}/spice-blends`]: { body: fixture("healthy.html") },
    [`${H}/`]: { body: "<html></html>" },
    [`${H}/about`]: { body: "<html></html>" },
    [`${H}/contact`]: { body: "<html></html>" },
    [`${H}/quality`]: { body: "<html></html>" },
    [`${H}/recipes`]: { status: 404, body: "nope" },
    [`${H}/img/blend.webp`]: { body: PNG, headers: { "content-type": "image/png" } },
    [`${H}/img/divider.png`]: { body: PNG, headers: { "content-type": "image/png" } },
    [`${H}/img/kitchen.webp`]: { body: PNG, headers: { "content-type": "image/png" } },
  };

  it("audits a healthy page and emits real stage progress in order", async () => {
    const { rec, events, deps } = await audit(healthyRoutes, `${H}/spice-blends`, { primaryKeyword: "spice blends" });
    expect(rec.status).toBe("partial"); // performance not run in tests -> partial
    expect(deps.saved[0].id).toBe(rec.id);
    const done = events.filter((e) => e.type === "stage" && (e.status === "completed" || e.status === "skipped")).map((e) => (e as { stage: string }).stage);
    expect(new Set(done)).toEqual(new Set(stagesForMode("quick").map((s) => s.id as string)));
    expect(events.at(-1)).toMatchObject({ type: "done", auditId: rec.id });
    expect(check(rec, "title-present")?.status).toBe("pass");
    expect(check(rec, "canonical-target")?.status).toBe("pass");
    expect(check(rec, "sitemap-includes-url")?.status).toBe("pass");
    expect(check(rec, "broken-internal-links")?.status).toBe("fail");
    expect(check(rec, "broken-internal-links")?.evidence.join()).toContain("/recipes");
    expect(check(rec, "geo-org-schema")?.status).toBe("pass");
    expect(check(rec, "aeo-direct-answers")?.status).toBe("pass");
    expect(check(rec, "kw-title")?.status).toBe("pass");
    expect(check(rec, "google-index-status")?.status).toBe("not_tested");
    expect(check(rec, "perf-score-mobile")?.status).toBe("not_tested");
    expect(rec.aiCrawlers.find((a) => a.agent === "GPTBot")?.allowed).toBe(false);
    expect(rec.aiCrawlers.find((a) => a.agent === "OAI-SearchBot")?.allowed).toBe(true);
    expect(rec.scores.categories.performance.score).toBeNull();
    expect(rec.scores.overall.score).not.toBeNull();
    expect(rec.images.every((i) => i.probe?.status === 200 && i.probe.width === 1)).toBe(true);
  });

  it("flags missing title and description", async () => {
    const { rec } = await audit({ "https://x.example.com/": { body: fixture("missing-title-desc.html") } }, "https://x.example.com/");
    expect(check(rec, "title-present")?.status).toBe("fail");
    expect(check(rec, "meta-description")?.status).toBe("warning");
    expect(check(rec, "robots-txt")?.status).toBe("warning"); // 404 robots
  });

  it("flags multiple H1s, skipped levels, empty and duplicate headings", async () => {
    const { rec } = await audit({ "https://x.example.com/": { body: fixture("multiple-headings.html") } }, "https://x.example.com/");
    expect(check(rec, "h1-multiple")?.status).toBe("warning");
    expect(check(rec, "heading-hierarchy")?.status).toBe("warning");
    expect(check(rec, "headings-empty")?.status).toBe("warning");
    expect(check(rec, "headings-duplicate")?.status).toBe("warning");
  });

  it("detects noindex from meta and from the X-Robots-Tag header", async () => {
    const { rec } = await audit({ "https://x.example.com/": { body: fixture("noindex.html") } }, "https://x.example.com/");
    expect(check(rec, "noindex")?.status).toBe("fail");
    expect(check(rec, "nofollow-directive")?.status).toBe("warning");
    expect(check(rec, "canonical-noindex-conflict")?.status).toBe("warning");
    const hdr = await audit({ "https://x.example.com/": { body: "<title>t</title>", headers: { "x-robots-tag": "noindex" } } }, "https://x.example.com/");
    expect(check(hdr.rec, "noindex")?.status).toBe("fail");
  });

  it("detects canonical mismatch, conflicting canonicals and a redirecting canonical target", async () => {
    const { rec } = await audit({
      [`${H}/products`]: { body: fixture("canonical-mismatch.html") },
      [`${H}/canonical-target`]: { redirect: `${H}/elsewhere` },
    }, `${H}/products`);
    expect(check(rec, "canonical-multiple")?.status).toBe("fail");
    expect(check(rec, "canonical-target")?.status).toBe("fail");
    expect(check(rec, "canonical-target")?.explanation).toMatch(/301/);
  });

  it("reports broken and oversized images", async () => {
    const { rec } = await audit({
      "https://x.example.com/": { body: fixture("broken-images.html") },
      "https://x.example.com/img/ok.png": { body: PNG, headers: { "content-type": "image/png" } },
      "https://x.example.com/img/huge.jpg": { status: 206, body: PNG, headers: { "content-type": "image/jpeg", "content-range": "bytes 0-65535/2400000" } },
    }, "https://x.example.com/");
    expect(check(rec, "img-broken")?.status).toBe("fail");
    expect(check(rec, "img-broken")?.evidence.join()).toContain("missing.jpg");
    expect(check(rec, "img-oversized")?.status).toBe("warning");
    expect(check(rec, "img-modern-format")?.status).toBe("warning");
  });

  it("does not count timeouts or refused connections as broken images/links", async () => {
    const timeout = Object.assign(new Error("The request timed out."), { code: "timeout" });
    const dns = Object.assign(new Error("The domain could not be resolved."), { code: "dns" });
    const routes: Record<string, Route> = { "https://x.example.com/": { body: '<title>t</title><img src="/slow.png" alt="slow"><img src="https://gone.example.org/x.png" alt="gone"><a href="/slow">Slow</a>' } };
    const fetcher = fixtureFetcher(routes);
    const inner = fetcher.fetch.bind(fetcher);
    fetcher.fetch = async (u, o) => {
      if (u.endsWith("/slow.png") || u.endsWith("/slow")) throw timeout;
      if (u.startsWith("https://gone.example.org")) throw dns;
      return inner(u, o);
    };
    const rec = await runAudit(baseInput("https://x.example.com/"), testDeps(fetcher), () => {});
    const img = rec.checks.find((c) => c.id === "img-broken")!;
    expect(img.evidence).toHaveLength(1);
    expect(img.evidence[0]).toContain("gone.example.org");
    expect(img.limitation).toMatch(/could not be verified/);
    expect(rec.checks.find((c) => c.id === "broken-internal-links")?.status).toBe("pass");
  });

  it("reports missing ALT separately from intentionally empty ALT", async () => {
    const { rec } = await audit({ "https://x.example.com/": { body: fixture("missing-alt.html") } }, "https://x.example.com/");
    expect(check(rec, "img-alt-missing")?.evidence).toEqual(["https://x.example.com/a.png"]);
    expect(check(rec, "img-alt-empty")?.status).toBe("info");
    expect(check(rec, "img-alt-quality")?.status).toBe("warning");
  });

  it("follows redirects and records the chain", async () => {
    const { rec } = await audit({
      "http://x.example.com/": { redirect: "https://x.example.com/" },
      "https://x.example.com/": { redirect: "https://www.x.example.com/home" },
      "https://www.x.example.com/home": { body: fixture("healthy.html") },
    }, "http://x.example.com/");
    expect(rec.finalUrl).toBe("https://www.x.example.com/home");
    expect(rec.redirects).toHaveLength(2);
    expect(check(rec, "redirect-chain")?.status).toBe("warning");
    expect(check(rec, "https")?.status).toBe("pass");
  });

  it("refuses redirects to private addresses", async () => {
    await expect(audit({ "https://x.example.com/": { redirect: "http://169.254.169.254/latest/meta-data/" } }, "https://x.example.com/")).rejects.toBeInstanceOf(AuditFailedError);
  });

  it("flags malformed JSON-LD and FAQ markup that is not visible", async () => {
    const { rec } = await audit({ "https://x.example.com/": { body: fixture("malformed-jsonld.html") } }, "https://x.example.com/");
    expect(check(rec, "jsonld-syntax")?.status).toBe("fail");
    expect(check(rec, "structured-data-properties")?.status).toBe("warning");
    expect(check(rec, "aeo-faq-consistency")?.status).toBe("fail");
  });

  it("flags likely JS-rendered content without rendering, and measures it with rendering", async () => {
    const routes = { "https://x.example.com/": { body: fixture("js-rendered.html") } };
    const { rec } = await audit(routes, "https://x.example.com/");
    expect(check(rec, "geo-js-dependency")?.status).toBe("warning");
    const rendered = await audit(routes, "https://x.example.com/", { renderJs: true }, {
      renderingAvailable: true,
      render: async () => ({ status: "ok", renderedWordCount: 900, viewports: [{ name: "Mobile", width: 375, height: 812, scrollWidth: 375, horizontalOverflow: false, clippedElements: 0, smallTextRatio: 0, smallTapTargets: 0, tapTargetsChecked: 10, imagesWiderThanViewport: 0 }] }),
    });
    expect(check(rendered.rec, "geo-js-dependency")?.status).toBe("fail");
    expect(check(rendered.rec, "mobile-overflow")?.status).toBe("pass");
  });

  it("respects robots.txt disallow for our crawler", async () => {
    await expect(audit({ "https://x.example.com/robots.txt": { body: "User-agent: *\nDisallow: /\n" }, "https://x.example.com/": { body: "<title>x</title>" } }, "https://x.example.com/")).rejects.toThrow(/robots\.txt disallows/);
    const { rec } = await audit({ "https://x.example.com/robots.txt": { body: "User-agent: *\nDisallow: /\n" }, "https://x.example.com/": { body: "<title>x</title>" } }, "https://x.example.com/", { respectRobots: false });
    expect(check(rec, "robots-allows-page")?.status).toBe("fail");
  });

  it("respects the link-check crawl limit", async () => {
    const links = Array.from({ length: 30 }, (_, i) => `<a href="/p${i}">Page ${i}</a>`).join("");
    const { fetcher } = await audit({ "https://x.example.com/": { body: `<title>Links</title>${links}` } }, "https://x.example.com/", { linksToCheck: 5 });
    expect(fetcher.calls.filter((c) => /\/p\d+$/.test(c))).toHaveLength(5);
  });

  it("fails cleanly when the site cannot be fetched or is not HTML", async () => {
    await expect(audit({ "https://x.example.com/": { error: "The request timed out." } }, "https://x.example.com/")).rejects.toThrow(/timed out/);
    await expect(audit({ "https://x.example.com/": { body: "%PDF", headers: { "content-type": "application/pdf" } } }, "https://x.example.com/")).rejects.toThrow(/not an HTML page/);
  });

  it("audits a page that returns a server error and reports it as critical", async () => {
    const { rec } = await audit({ "https://err.example.com/": { status: 500, body: "<html><title>Error</title><body>Internal error</body></html>" } }, "https://err.example.com/");
    expect(check(rec, "http-status")?.status).toBe("fail");
    expect(check(rec, "http-status")?.severity).toBe("critical");
  });

  it("checks HTTP to HTTPS only from real evidence", async () => {
    const page = { body: fixture("healthy.html") };
    const redirecting = await audit({ "https://s.example.com/": page, "http://s.example.com/": { redirect: "https://s.example.com/", status: 301 } }, "https://s.example.com/");
    expect(check(redirecting.rec, "sec-http-to-https")?.status).toBe("pass");
    const served = await audit({ "https://s.example.com/": page, "http://s.example.com/": page }, "https://s.example.com/");
    expect(check(served.rec, "sec-http-to-https")?.status).toBe("fail");
    // An error status (for example from a proxy or firewall) proves nothing either way.
    const unknown = await audit({ "https://s.example.com/": page, "http://s.example.com/": { status: 405, body: "" } }, "https://s.example.com/");
    expect(check(unknown.rec, "sec-http-to-https")?.status).toBe("not_tested");
  });

  it("keeps auditing when the sitemap is inaccessible", async () => {
    const { rec } = await audit({
      "https://sm.example.com/robots.txt": { body: "User-agent: *\nAllow: /\nSitemap: https://sm.example.com/sitemap.xml\n", headers: { "content-type": "text/plain" } },
      "https://sm.example.com/sitemap.xml": { status: 503, body: "unavailable" },
      "https://sm.example.com/": { body: fixture("healthy.html") },
    }, "https://sm.example.com/");
    expect(rec.sitemap.status).not.toBe("found");
    expect(check(rec, "sitemap-found")?.status).not.toBe("pass");
    expect(check(rec, "title-present")?.status).toBe("pass");
  });

  it("stops when cancelled", async () => {
    const ctrl = new AbortController();
    const fetcher = fixtureFetcher({ "https://x.example.com/": { body: "<title>x</title>" } });
    const deps = testDeps(fetcher);
    const p = runAudit(baseInput("https://x.example.com/"), deps, (e) => { if (e.type === "stage" && e.stage === "fetch" && e.status === "completed") ctrl.abort(); }, ctrl.signal);
    await expect(p).rejects.toBeInstanceOf(AuditAbortedError);
    expect(deps.saved).toHaveLength(0);
  });

  it("uses real PageSpeed results for the performance score", async () => {
    const { rec } = await audit({ "https://x.example.com/": { body: "<title>Perf page title that is long enough</title><h1>x</h1>" } }, "https://x.example.com/", { runPerformance: true }, {
      pageSpeed: async (_u: string, s: "mobile" | "desktop") => ({ strategy: s, status: "ok", score: s === "mobile" ? 60 : 90, lab: { LCP: { value: 3000, display: "3.0 s", score: 0.6 } }, field: { source: "none", overall: null, metrics: {} }, opportunities: [] }),
    });
    expect(rec.scores.categories.performance.score).toBe(75);
    expect(check(rec, "perf-score-mobile")?.status).toBe("warning");
    expect(check(rec, "perf-lcp-mobile")?.status).toBe("warning");
  });
});
