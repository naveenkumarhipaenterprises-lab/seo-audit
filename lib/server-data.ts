import "server-only";
import { getStore, type AuditSummary } from "./store";

export async function previousAuditFor(finalUrl: string, before: string): Promise<AuditSummary | null> {
  const list = await getStore().list(200);
  return list.find((s) => s.finalUrl === finalUrl && s.createdAt < before) || null;
}
