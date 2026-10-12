import { describe, expect, it } from "vitest";
import { runAudit, AuditAbortedError } from "@/lib/audit/run";
import type { AuditEvent, AuditRecord } from "@/lib/audit/types";
import { stagesForMode } from "@/lib/audit/types";
import { baseInput, fixtureFetcher, testDeps, type Route } from "../helpers";

const S = "https://shop.example-site.com";
const words = (seed: string, n: number) => Array.from({ length: n }, (_, i) => `${seed}${i % 37} word${(i * 7) % 53}`).join(" ");
const page = (title: string, body: string, links: string[] = [], extraHead = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><meta name="description" content="${title} description text for this page">${extraHead}</head><body><main><h1>${title}</h1><p>${body}</p>${links.map((l) => `<a href="${l}">Read about ${l.replace(/\W/g, " ")}</a>`).join(" ")}</main></body></html>`;

const dupText = words("same", 400);
const routes: Record<string, Route> = {
  [`${S}/robots.txt`]: { body: `User-agent: *\nDisallow: /private\nSitemap: ${S}/sitemap.xml\n`, headers: { "content-type": "text/plain" } },
  [`${S}/sitemap.xml`]: { body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${S}/</loc></url><url><loc>${S}/orphan</loc></url><url><loc>${S}/gone</loc></url></urlset>`, headers: { "content-type": "application/xml" } },
  [`${S}/`]: { body: page("Home of the example shop", words("home", 300), ["/a", "/b", "/c", "/dup1", "/dup2", "/private/secret", "/redir"]) },
  [`${S}/a`]: { body: page("Section A guide", words("alpha", 300), ["/a/deep1", "/broken"]) },
  [`${S}/a/deep1`]: { body: page("Deep page one", words("deep", 300), ["/a/deep1/deep2"]) },
  [`${S}/a/deep1/deep2`]: { body: page("Too deep", words("toodeep", 300)) },
  [`${S}/b`]: { body: page("Same title", words("bravo", 300)) },
  [`${S}/c`]: { body: page("Same title", words("charlie", 300)) },
  [`${S}/dup1`]: { body: page("Duplicate one", dupText) },
  [`${S}/dup2`]: { body: page("Duplicate two", dupText) },
  [`${S}/orphan`]: { body: page("Orphan page", words("orphan", 300)) },
  [`${S}/gone`]: { status: 404, body: "gone" },
  [`${S}/broken`]: { status: 404, body: "nope" },
  [`${S}/redir`]: { redirect: `${S}/c`, status: 301 },
  [`${S}/private/secret`]: { body: page("Secret", "should never be fetched") },
};

const check = (r: AuditRecord, id: string) => r.checks.find((c) => c.id === id);

async function fullAudit(extra = {}, signal?: AbortSignal, overrides = {}) {
  const events: AuditEvent[] = [];
  const fetcher = fixtureFetcher(routes);
  const deps = testDeps(fetcher, overrides);
  const rec = await runAudit(baseInput(`${S}/`, { mode: "full", maxPages: 20, maxDepth: 2, ...extra }), deps, (e) => events.push(e), signal);
  return { rec, events, fetcher };
}

describe("full site audit", () => {
  it("crawls within depth, respects robots.txt and reports site-wide findings", async () => {
    const { rec, events, fetcher } = await fullAudit();
    const urls = rec.pages!.map((p) => p.finalUrl);
    expect(urls).toContain(`${S}/a/deep1`);
    expect(urls).not.toContain(`${S}/a/deep1/deep2`); // depth 3 > maxDepth 2
    expect(fetcher.calls.some((c) => c.includes("/private/secret"))).toBe(false);
    expect(rec.crawl).toMatchObject({ enabled: true, maxPages: 20, maxDepth: 2 });
    expect(rec.crawl!.skippedRobots).toBeGreaterThanOrEqual(1);
    // /redir and /c resolve to the same final URL and are deduplicated.
    expect(rec.pages!.filter((p) => p.finalUrl === `${S}/c` && p.wordCount > 0)).toHaveLength(1);
    expect(rec.pages!.find((p) => p.url === `${S}/redir`)?.issues.join()).toMatch(/already crawled/);

    expect(check(rec, "duplicate-titles-sitewide")?.status).not.toBe("pass");
    expect(check(rec, "duplicate-titles-sitewide")?.affectedUrls).toEqual(expect.arrayContaining([`${S}/b`, `${S}/c`]));
    expect(check(rec, "duplicate-content")?.status).not.toBe("pass");
    expect(check(rec, "duplicate-content")?.affectedUrls).toEqual(expect.arrayContaining([`${S}/dup1`, `${S}/dup2`]));
    expect(check(rec, "broken-internal-links")?.status).toBe("fail");
    expect(check(rec, "broken-internal-links")?.evidence.join(" ")).toContain("/broken");

    // Progress: crawl stage exists in full mode and page counters were emitted.
    const done = events.filter((e) => e.type === "stage" && (e.status === "completed" || e.status === "skipped")).map((e) => (e as { stage: string }).stage);
    expect(new Set(done)).toEqual(new Set(stagesForMode("full").map((s) => s.id as string)));
    expect(events.some((e) => e.type === "pages")).toBe(true);
    expect(check(rec, "sitemap-url-validity")?.status).toBe("warning"); // /gone returns 404
    expect(check(rec, "site-http-errors")?.status).toBe("fail");
    // The crawl hit the depth limit, so orphan detection is not claimed.
    expect(check(rec, "orphan-pages")?.status).toBe("not_tested");
    // Every check carries provenance and a detection time.
    expect(rec.checks.every((c) => c.source && c.detectedAt)).toBe(true);
  });

  it("detects orphan sitemap URLs when the crawl is complete", async () => {
    const { rec } = await fullAudit({ maxDepth: 3 });
    expect(rec.crawl!.stopReason).toBe("complete");
    const o = check(rec, "orphan-pages");
    expect(o?.status).toBe("warning");
    expect(o?.affectedUrls).toContain(`${S}/orphan`);
    expect(o?.affectedUrls).not.toContain(`${S}/a`);
  });

  it("stops at the configured page limit and does not claim orphan detection on an incomplete crawl", async () => {
    const { rec } = await fullAudit({ maxPages: 3 });
    expect(rec.pages!.length).toBeLessThanOrEqual(3);
    expect(rec.crawl!.stopReason).toBe("page_limit");
    expect(check(rec, "orphan-pages")?.status ?? "not_tested").toBe("not_tested");
  });

  it("can be cancelled mid-audit", async () => {
    const ac = new AbortController();
    let n = 0;
    const slowFetcher = fixtureFetcher(routes);
    const orig = slowFetcher.fetch.bind(slowFetcher);
    slowFetcher.fetch = async (u, o) => {
      if (++n === 4) ac.abort();
      if (o?.signal?.aborted) throw new Error("aborted");
      return orig(u, o);
    };
    const deps = testDeps(slowFetcher);
    await expect(runAudit(baseInput(`${S}/`, { mode: "full", maxPages: 20, maxDepth: 2 }), deps, () => undefined, ac.signal)).rejects.toBeInstanceOf(AuditAbortedError);
    expect(deps.saved).toHaveLength(0);
  });
});
