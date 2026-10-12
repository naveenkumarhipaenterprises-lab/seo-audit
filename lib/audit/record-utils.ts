import { FINAL_STATUS_LABELS, type AuditFinalStatus, type AuditInput, type AuditRecord, type CheckResult, type FindingSource, type StageStatus } from "./types";

/** Provenance of a finding; older audits stored before provenance existed are inferred from their category. */
export function sourceOf(c: CheckResult): FindingSource {
  if (c.source) return c.source;
  if (c.category === "performance") return "external";
  if (c.category === "aeo" || c.category === "geo") return "assessment";
  return "observed";
}

export function normalizeStageStatus(s: string): StageStatus {
  if (s === "done") return "completed";
  if (s === "pending") return "queued";
  return s as StageStatus;
}

export function statusLabel(s: string): string {
  if (s === "complete") return FINAL_STATUS_LABELS.completed;
  return FINAL_STATUS_LABELS[s as AuditFinalStatus] ?? s;
}

export const isPartialStatus = (s: string) => s === "partial";

/**
 * Upgrades audits saved by older engine versions in memory so new UI code can rely on
 * the current shape. Stored files are never rewritten by this.
 */
export function normalizeRecord(r: AuditRecord): AuditRecord {
  const status = (r.status as string) === "complete" ? "completed" : r.status;
  const defaults: Partial<AuditInput> = { mode: "quick", maxPages: 1, maxDepth: 0, performanceStrategy: "both", useSearchConsole: false };
  const input = { ...defaults, ...(r.input as Partial<AuditInput>) } as AuditInput;
  return {
    ...r,
    status,
    input,
    stages: (r.stages || []).map((s) => ({ ...s, status: normalizeStageStatus(s.status) })),
    issueStates: r.issueStates || {},
    warnings: r.warnings || [],
    pages: r.pages || [],
    competitors: r.competitors || [],
  };
}
