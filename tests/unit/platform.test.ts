import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { canAccess, ownerIdFromCookieHeader, ownerIdFromToken } from "@/lib/security/owner";
import { parseAuditInput } from "@/lib/audit/input";
import { compareAudits } from "@/lib/audit/compare";
import { retryPerformance } from "@/lib/audit/retry-performance";
import { parsePsiResponse, notTestedPerformance } from "@/lib/audit/pagespeed";
import { decrypt, encrypt, matchProperty } from "@/lib/integrations/gsc";
import { insecureCookies } from "@/lib/audit/checks/security";
import { jaccard, shingleSet, isCrawlableUrl } from "@/lib/audit/crawler";
import { normalizeRecord, statusLabel } from "@/lib/audit/record-utils";
import { _resetJobsForTests, cancelJob, findDuplicate, getJob, startJob, view } from "@/lib/audit/jobs";
import { runAudit } from "@/lib/audit/run";
import type { AuditRecord, PerformanceResult } from "@/lib/audit/types";
import { baseInput, fixture, fixtureFetcher, testDeps, type Route } from "../helpers";

const H = "https://www.example-healthy.com";
const routes: Record<string, Route> = {
  [`${H}/robots.txt`]: { body: "User-agent: *\nAllow: /\n", headers: { "content-type": "text/plain" } },
  [`${H}/spice-blends`]: { body: fixture("healthy.html") },
};
const okPerf = (strategy: "mobile" | "desktop", score = 88): PerformanceResult => ({
  strategy, status: "ok", fetchedAt: "2026-10-12T00:00:00.000Z", lighthouseVersion: "12", score,
  categories: { performance: score, accessibility: 90, bestPractices: 95, seo: 100 },
  lab: { LCP: { value: 2000, display: "2.0 s", score: 0.9 } }, field: { source: "none", overall: null, metrics: {} }, opportunities: [],
});

describe("report access control", () => {
  it("derives a stable opaque owner id and never accepts malformed tokens", () => {
    const tok = "a".repeat(48);
    expect(ownerIdFromToken(tok)).toMatch(/^[a-f0-9]{32}$/);
    expect(ownerIdFromToken(tok)).not.toContain(tok);
    expect(ownerIdFromCookieHeader(`x=1; ss_owner=${tok}`)).toBe(ownerIdFromToken(tok));
    expect(ownerIdFromCookieHeader("ss_owner=../../etc")).toBeNull();
    expect(ownerIdFromCookieHeader(null)).toBeNull();
  });
  it("limits records to their owner unless history is explicitly shared", () => {
    expect(canAccess("owner-a", "owner-a")).toBe(true);
    expect(canAccess("owner-a", "owner-b")).toBe(false);
    expect(canAccess("owner-a", null)).toBe(false);
    expect(canAccess(undefined, null)).toBe(true); // pre-ownership records
    vi.stubEnv("AUDIT_SHARED_HISTORY", "1");
    expect(canAccess("owner-a", "owner-b")).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("audit settings validation", () => {
  it("applies defaults and bounds", () => {
    const r = parseAuditInput({ url: "example.com" });
    expect(r.ok && r.input).toMatchObject({ mode: "quick", maxPages: 25, maxDepth: 2, performanceStrategy: "both", enableAi: false });
    expect(parseAuditInput({ url: "example.com", mode: "full", maxPages: 500 }).ok).toBe(false);
    expect(parseAuditInput({ url: "example.com", maxDepth: 9 }).ok).toBe(false);
    expect(parseAuditInput({ url: "example.com", competitorUrls: ["a.com", "b.com", "c.com", "d.com"] }).ok).toBe(false);
    expect(parseAuditInput({ url: "example.com", performanceStrategy: "tablet" }).ok).toBe(false);
  });
});

describe("PageSpeed Insights parsing", () => {
  it("reads every Lighthouse category and never invents field data", () => {
    const r = parsePsiResponse("mobile", {
      lighthouseResult: {
        lighthouseVersion: "12.0.0", fetchTime: "2026-10-12T10:00:00.000Z",
        categories: { performance: { score: 0.71 }, accessibility: { score: 0.93 }, "best-practices": { score: 1 }, seo: { score: 0.92 } },
        audits: { "largest-contentful-paint": { numericValue: 3100, displayValue: "3.1 s", score: 0.5 }, "total-blocking-time": { numericValue: 300, displayValue: "300 ms", score: 0.6 } },
      },
    } as never);
    expect(r.categories).toEqual({ performance: 71, accessibility: 93, bestPractices: 100, seo: 92 });
    expect(r.field.source).toBe("none");
    expect(r.field.metrics.INP).toBeUndefined();
  });

  describe("against a stub endpoint", () => {
    let server: http.Server;
    let status = 429;
    beforeAll(async () => {
      server = http.createServer((_req, res) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Quota exceeded for quota metric" } }));
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    });
    afterAll(() => server.close());
    it("flags quota errors and returns no score", async () => {
      vi.stubEnv("PAGESPEED_ENDPOINT", `http://127.0.0.1:${(server.address() as AddressInfo).port}/run`);
      vi.resetModules();
      const { runPageSpeed } = await import("@/lib/audit/pagespeed");
      const r = await runPageSpeed("https://example.com/", "mobile");
      expect(r).toMatchObject({ status: "error", quota: true, score: null });
      status = 500;
      const r2 = await runPageSpeed("https://example.com/", "desktop");
      expect(r2).toMatchObject({ status: "error", score: null });
      expect(r2.quota).toBe(false);
      vi.unstubAllEnvs();
    });
  });
});

describe("performance failures do not invalidate other results", () => {
  it("keeps technical findings and marks the audit partial, then a retry fills performance in", async () => {
    const deps = testDeps(fixtureFetcher(routes), {
      pageSpeed: async (_u: string, s: "mobile" | "desktop") => ({ ...notTestedPerformance(s, "PageSpeed Insights shared quota exceeded."), status: "error" as const, quota: true }),
      pageSpeedConfigured: true,
    });
    const rec = await runAudit(baseInput(`${H}/spice-blends`, { runPerformance: true }), deps, () => undefined);
    expect(rec.status).toBe("partial");
    expect(rec.checks.find((c) => c.id === "title-present")?.status).toBe("pass");
    expect(rec.scores.categories.performance.score).toBeNull();
    expect(rec.scores.seo.score).not.toBeNull();

    const fixed = await retryPerformance(rec, async (_u, s) => okPerf(s));
    expect(fixed.performance.every((p) => p.status === "ok")).toBe(true);
    expect(fixed.scores.categories.performance.score).toBe(88);
    expect(fixed.checks.find((c) => c.id === "title-present")).toEqual(rec.checks.find((c) => c.id === "title-present"));
    // A later failed retry does not throw away the successful results.
    const again = await retryPerformance(fixed, async (_u, s) => ({ ...notTestedPerformance(s, "down"), status: "error" }));
    expect(again.performance.every((p) => p.status === "ok")).toBe(true);
  });
});

describe("audit comparison", () => {
  it("separates new, resolved, unchanged and not re-tested issues", () => {
    const mk = (checks: [string, string][], pages: string[]) => ({
      id: "x", createdAt: "2026-10-01T00:00:00Z", finalUrl: "https://a.com/", input: { mode: "full" },
      checks: checks.map(([id, status]) => ({ id, status, title: id, category: "technical", severity: "high" })),
      pages: pages.map((u) => ({ finalUrl: u })),
      scores: { overall: { score: 50 }, seo: { score: 50 }, categories: { aeo: { score: 1 }, geo: { score: 1 }, performance: { score: null } } },
    }) as unknown as AuditRecord;
    const prev = mk([["a", "fail"], ["b", "fail"], ["c", "warning"], ["d", "fail"]], ["https://a.com/", "https://a.com/old"]);
    const cur = mk([["a", "fail"], ["b", "pass"], ["c", "not_tested"], ["e", "warning"]], ["https://a.com/", "https://a.com/new"]);
    const c = compareAudits(cur, prev);
    expect(c.newIssues.map((x) => x.id)).toEqual(["e"]);
    expect(c.resolvedIssues.map((x) => x.id)).toEqual(["b"]);
    expect(c.unchangedIssues.map((x) => x.id)).toEqual(["a"]);
    expect(c.notRetested.map((x) => x.id).sort()).toEqual(["c", "d"]);
    expect(c.pagesAdded).toEqual(["https://a.com/new"]);
    expect(c.pagesRemoved).toEqual(["https://a.com/old"]);
  });
});

describe("Search Console helpers", () => {
  it("matches the most specific verified property", () => {
    const sites = [
      { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
      { siteUrl: "https://www.example.com/blog/", permissionLevel: "siteFullUser" },
      { siteUrl: "https://www.example.com/", permissionLevel: "siteUnverifiedUser" },
    ];
    expect(matchProperty("https://www.example.com/blog/post", sites)?.siteUrl).toBe("https://www.example.com/blog/");
    expect(matchProperty("https://shop.example.com/", sites)?.siteUrl).toBe("sc-domain:example.com");
    expect(matchProperty("https://www.example.com/about", sites)?.siteUrl).toBe("sc-domain:example.com");
    expect(matchProperty("https://other.com/", sites)).toBeNull();
  });
  it("encrypts stored tokens with authenticated encryption", () => {
    const k = Buffer.alloc(32, 7);
    const blob = encrypt("refresh-token", k);
    expect(blob).not.toContain("refresh-token");
    expect(decrypt(blob, k)).toBe("refresh-token");
    expect(() => decrypt(blob, Buffer.alloc(32, 8))).toThrow();
  });
});

describe("helpers", () => {
  it("detects insecure cookies, near duplicates and crawl traps", () => {
    expect(insecureCookies("a=1; Path=/\nb=2; Secure; HttpOnly")).toEqual(["a: missing Secure and HttpOnly"]);
    const t = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    expect(jaccard(shingleSet(t), shingleSet(t))).toBe(1);
    expect(jaccard(shingleSet(t), shingleSet(t.split(" ").reverse().join(" ")))).toBeLessThan(0.1);
    expect(isCrawlableUrl("https://a.com/x/x/x/x/x/x/x")).toBe(false);
    expect(isCrawlableUrl("https://a.com/products/shoes")).toBe(true);
  });
  it("upgrades legacy records without changing stored data", () => {
    const legacy = { status: "complete", input: { url: "x" }, stages: [{ id: "fetch", status: "done" }] } as unknown as AuditRecord;
    const n = normalizeRecord(legacy);
    expect(n.status).toBe("completed");
    expect(n.input.mode).toBe("quick");
    expect(n.stages[0].status).toBe("completed");
    expect((legacy as { status: string }).status).toBe("complete");
    expect(statusLabel("partial")).toBe("Partially completed");
  });
});

describe("background jobs", () => {
  beforeEach(() => _resetJobsForTests());
  const store = () => {
    const outcomes: { status: string }[] = [];
    return { outcomes, saveOutcome: async (s: { status: string }) => void outcomes.push(s) };
  };
  const until = async (fn: () => boolean) => {
    for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
  };

  it("runs to completion, records the report id and releases its slot", async () => {
    let released = 0;
    const deps = testDeps(fixtureFetcher(routes));
    const job = startJob(baseInput(`${H}/spice-blends`), "owner-a", deps, store(), () => released++);
    expect(findDuplicate("owner-a", baseInput(`${H}/spice-blends`))?.id).toBe(job.id);
    expect(findDuplicate("owner-b", baseInput(`${H}/spice-blends`))).toBeNull();
    await until(() => job.status !== "running");
    expect(job.status).toBe("partial");
    expect(job.auditId).toBe(deps.saved[0].id);
    expect(released).toBe(1);
    const v = view(job);
    expect(v.percent).toBe(100);
    expect(v.stages.every((s) => s.status === "completed" || s.status === "skipped")).toBe(true);
    expect(getJob(job.id, "owner-b")).toBeNull();
  });

  it("cancels a running job and saves a cancelled outcome without a report", async () => {
    const s = store();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = fixtureFetcher(routes);
    const deps = testDeps({ fetch: async (u, o) => { await gate; if (o?.signal?.aborted) throw new Error("aborted"); return base.fetch(u, o); } });
    const job = startJob(baseInput(`${H}/spice-blends`), "owner-a", deps, s, () => undefined);
    expect(cancelJob(job.id, "owner-b")).toBe(false);
    expect(cancelJob(job.id, "owner-a")).toBe(true);
    release();
    await until(() => job.status !== "running");
    expect(job.status).toBe("cancelled");
    expect(s.outcomes[0]).toMatchObject({ status: "cancelled" });
    expect(deps.saved).toHaveLength(0);
    expect(job.stages.some((x) => x.status === "running")).toBe(false);
  });

  it("reports a failed job when the site cannot be reached", async () => {
    const s = store();
    const deps = testDeps(fixtureFetcher({ "https://down.example.com/": { error: "connect ECONNREFUSED" } }));
    const job = startJob(baseInput("https://down.example.com/"), null, deps, s, () => undefined);
    await until(() => job.status !== "running");
    expect(job.status).toBe("failed");
    expect(job.error?.message).toBeTruthy();
    expect(s.outcomes[0]).toMatchObject({ status: "failed" });
  });
});
