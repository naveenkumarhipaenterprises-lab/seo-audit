import "server-only";
import { getStore, type AuditSummary } from "./store";
import { currentOwnerId } from "./security/owner-server";
import type { AuditRecord } from "./audit/types";

/** Audits visible to the current browser (see lib/security/owner). */
export async function listAudits(limit = 50): Promise<AuditSummary[]> {
  return getStore().list(await currentOwnerId(), limit);
}

export async function getAudit(id: string): Promise<AuditRecord | null> {
  return getStore().get(id, await currentOwnerId());
}

/** Most recent audit that has a full report (failed/cancelled audits have none). */
export async function latestReportSummary(): Promise<AuditSummary | null> {
  return (await listAudits(20)).find((a) => a.hasReport !== false) || null;
}

export async function previousAuditFor(finalUrl: string, before: string): Promise<AuditRecord | null> {
  const prev = (await listAudits(200)).find((s) => s.finalUrl === finalUrl && s.createdAt < before && s.hasReport !== false);
  return prev ? getAudit(prev.id) : null;
}

/** Props the audit form needs from the server (no secrets). */
export async function auditFormProps() {
  const { renderingConfigured } = await import("./audit/render");
  const { connectionStatus } = await import("./integrations/gsc");
  const gsc = await connectionStatus(await currentOwnerId());
  return { renderingAvailable: renderingConfigured(), gsc: { configured: gsc.configured, connected: gsc.connected } };
}
