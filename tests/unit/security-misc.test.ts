import { beforeEach, describe, expect, it } from "vitest";
import { checkBasicAuth } from "@/lib/security/access";
import { acquireAuditSlot, checkRateLimit, _resetRateLimitForTests } from "@/lib/security/rate-limit";
import { parseAuditInput } from "@/lib/audit/input";
import { parsePsiResponse } from "@/lib/audit/pagespeed";

describe("API authorization (APP_PASSWORD gate)", () => {
  const b = (s: string) => `Basic ${btoa(s)}`;
  it("allows everything when no password is configured", () => expect(checkBasicAuth(null, undefined)).toBe("allowed"));
  it("requires matching credentials when configured", () => {
    expect(checkBasicAuth(null, "s3cret")).toBe("denied");
    expect(checkBasicAuth(b("admin:wrong"), "s3cret")).toBe("denied");
    expect(checkBasicAuth(b("root:s3cret"), "s3cret")).toBe("denied");
    expect(checkBasicAuth("Basic %%%", "s3cret")).toBe("denied");
    expect(checkBasicAuth(b("admin:s3cret"), "s3cret")).toBe("allowed");
    expect(checkBasicAuth(b("me:pa:ss"), "pa:ss", "me")).toBe("allowed");
  });
});

describe("rate limiting and concurrency", () => {
  beforeEach(() => _resetRateLimitForTests());
  it("limits audits per client per window", () => {
    const now = 1_000_000;
    for (let i = 0; i < 6; i++) expect(checkRateLimit("ip", now).ok).toBe(true);
    expect(checkRateLimit("ip", now)).toMatchObject({ ok: false });
    expect(checkRateLimit("other", now).ok).toBe(true);
    expect(checkRateLimit("ip", now + 61_000).ok).toBe(true);
  });
  it("caps concurrent audits", () => {
    const slots = [acquireAuditSlot(), acquireAuditSlot(), acquireAuditSlot()];
    expect(slots.every(Boolean)).toBe(true);
    expect(acquireAuditSlot()).toBeNull();
    slots[0]!();
    slots[0]!(); // double release is a no-op
    expect(acquireAuditSlot()).not.toBeNull();
    expect(acquireAuditSlot()).toBeNull();
  });
});

describe("input validation", () => {
  it("applies defaults and bounds", () => {
    const r = parseAuditInput({ url: "example.com" });
    expect(r).toMatchObject({ ok: true, input: { respectRobots: true, linksToCheck: 20 } });
    expect(parseAuditInput({ url: "x.com", linksToCheck: 5000 }).ok).toBe(false);
    expect(parseAuditInput({ url: 5 }).ok).toBe(false);
    expect(parseAuditInput({}).ok).toBe(false);
  });
});

describe("PageSpeed parsing", () => {
  it("separates lab and field data and never invents INP", () => {
    const r = parsePsiResponse("mobile", {
      lighthouseResult: { lighthouseVersion: "12.0.0", categories: { performance: { score: 0.47 } }, audits: { "largest-contentful-paint": { numericValue: 5200, displayValue: "5.2 s", score: 0.2 }, "render-blocking-resources": { title: "Eliminate render-blocking resources", score: 0.3, details: { type: "opportunity", overallSavingsMs: 900 } } } },
      loadingExperience: { metrics: {} },
      originLoadingExperience: { overall_category: "AVERAGE", metrics: { CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12, category: "FAST" } } },
    });
    expect(r.score).toBe(47);
    expect(r.lab.LCP.value).toBe(5200);
    expect(r.lab.TBT.value).toBeNull();
    expect(r.field.source).toBe("origin");
    expect(r.field.metrics.CLS.p75).toBe(0.12);
    expect(r.field.metrics.INP).toBeUndefined();
    expect(r.opportunities[0].id).toBe("render-blocking-resources");
  });
});
