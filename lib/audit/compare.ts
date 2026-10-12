import { normalizeForCompareClient } from "./url-utils";
import type { AuditRecord, CheckResult } from "./types";

const isIssue = (c: CheckResult) => c.status === "fail" || c.status === "warning";

export interface AuditComparison {
  previousId: string;
  previousDate: string;
  sameMode: boolean;
  newIssues: CheckResult[];
  resolvedIssues: CheckResult[];
  unchangedIssues: CheckResult[];
  /** Issues from the previous audit whose check did not run this time (not counted as resolved). */
  notRetested: CheckResult[];
  pagesAdded: string[];
  pagesRemoved: string[];
  scores: { label: string; now: number | null; before: number | null }[];
}

/** Compares two real, stored audit snapshots of the same URL. */
export function compareAudits(cur: AuditRecord, prev: AuditRecord): AuditComparison {
  const prevById = new Map(prev.checks.map((c) => [c.id, c]));
  const curById = new Map(cur.checks.map((c) => [c.id, c]));
  const newIssues: CheckResult[] = [];
  const unchangedIssues: CheckResult[] = [];
  for (const c of cur.checks.filter(isIssue)) {
    const p = prevById.get(c.id);
    if (p && isIssue(p)) unchangedIssues.push(c);
    else newIssues.push(c);
  }
  const resolvedIssues: CheckResult[] = [];
  const notRetested: CheckResult[] = [];
  for (const p of prev.checks.filter(isIssue)) {
    const c = curById.get(p.id);
    if (!c || c.status === "not_tested") notRetested.push(p);
    else if (c.status === "pass" || c.status === "not_applicable") resolvedIssues.push(c);
  }
  const pageSet = (r: AuditRecord) => new Set((r.pages?.length ? r.pages.map((p) => p.finalUrl) : [r.finalUrl]).map(normalizeForCompareClient));
  const a = pageSet(cur);
  const b = pageSet(prev);
  const sc = (r: AuditRecord) => r.scores;
  return {
    previousId: prev.id,
    previousDate: prev.createdAt,
    sameMode: (cur.input.mode || "quick") === (prev.input.mode || "quick"),
    newIssues,
    resolvedIssues,
    unchangedIssues,
    notRetested,
    pagesAdded: Array.from(a).filter((u) => !b.has(u)),
    pagesRemoved: Array.from(b).filter((u) => !a.has(u)),
    scores: [
      { label: "Overall", now: sc(cur).overall.score, before: sc(prev).overall.score },
      { label: "SEO", now: sc(cur).seo.score, before: sc(prev).seo.score },
      { label: "AEO", now: sc(cur).categories.aeo.score, before: sc(prev).categories.aeo.score },
      { label: "GEO", now: sc(cur).categories.geo.score, before: sc(prev).categories.geo.score },
      { label: "Performance", now: sc(cur).categories.performance.score, before: sc(prev).categories.performance.score },
    ],
  };
}
