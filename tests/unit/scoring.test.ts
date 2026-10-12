import { describe, expect, it } from "vitest";
import { computeScores, prioritizedIssues } from "@/lib/scoring/score";
import type { CheckResult } from "@/lib/audit/types";

const c = (id: string, category: CheckResult["category"], status: CheckResult["status"], severity: CheckResult["severity"] = "medium", extra: Partial<CheckResult> = {}): CheckResult => ({
  id, category, status, severity, group: "g", title: id, url: "https://x.example.com/", evidence: [], explanation: "", recommendation: "", detection: "", ...extra,
});

describe("scoring engine", () => {
  it("awards full, half and zero credit by severity points", () => {
    // high=5 pass, medium=2 warning (1), low=1 fail (0) -> 6/8 = 75
    const s = computeScores([c("a", "technical", "pass", "high"), c("b", "technical", "warning", "medium"), c("d", "technical", "fail", "low")]);
    expect(s.categories.technical).toMatchObject({ score: 75, earned: 6, possible: 8 });
  });
  it("excludes not applicable, not tested and info from the denominator", () => {
    const s = computeScores([c("a", "aeo", "pass", "low"), c("b", "aeo", "not_tested", "critical"), c("x", "aeo", "not_applicable", "high"), c("i", "aeo", "info")]);
    expect(s.categories.aeo.score).toBe(100);
    expect(s.categories.geo.score).toBeNull();
  });
  it("uses the Lighthouse score directly for performance", () => {
    const s = computeScores([c("perf-score-mobile", "performance", "warning", "high", { measuredScore: 41 }), c("perf-lcp-mobile", "performance", "fail"), c("perf-score-desktop", "performance", "pass", "high", { measuredScore: 93 })]);
    expect(s.categories.performance.score).toBe(67);
  });
  it("combines SEO, AEO and GEO with documented weights and redistributes missing components", () => {
    const all = computeScores([c("t", "technical", "pass"), c("a", "aeo", "fail"), c("g", "geo", "pass")]);
    // SEO = technical only (100); overall over tested parts SEO 45 / AEO 20 / GEO 20 = (4500 + 0 + 2000) / 85 = 76
    expect(all.seo.score).toBe(100);
    expect(all.overall.score).toBe(76);
    expect(all.overall.partial).toBe(true);
    const noGeo = computeScores([c("t", "technical", "pass"), c("a", "aeo", "fail")]);
    // weights 45/20 renormalised: 100*(45/65) + 0 = 69
    expect(noGeo.overall.score).toBe(69);
    expect(noGeo.overall.components.find((x) => x.name === "GEO")?.effectiveWeight).toBe(0);
  });
  it("returns null scores when nothing was tested", () => {
    const s = computeScores([c("x", "technical", "not_tested")]);
    expect(s.overall.score).toBeNull();
    expect(s.totals.notTested).toBe(1);
  });
  it("is deterministic and reproducible from stored checks", () => {
    const checks = [c("a", "technical", "pass", "critical"), c("b", "images", "warning"), c("d", "geo", "fail", "high"), c("e", "mobile", "pass")];
    expect(computeScores(JSON.parse(JSON.stringify(checks)))).toEqual(computeScores(checks));
  });
  it("orders issues by severity", () => {
    const list = prioritizedIssues([c("low", "technical", "fail", "low"), c("crit", "technical", "fail", "critical"), c("pass", "technical", "pass", "critical"), c("hw", "technical", "warning", "high")]);
    expect(list.map((x) => x.id)).toEqual(["crit", "hw", "low"]);
  });
});
