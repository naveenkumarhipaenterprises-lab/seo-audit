import type { AuditRecord } from "../audit/types";

export function reportFilename(r: AuditRecord, ext: "pdf" | "csv") {
  const host = (() => {
    try {
      return new URL(r.finalUrl).hostname.replace(/[^a-z0-9.-]/gi, "");
    } catch {
      return "site";
    }
  })();
  return `searchscope-${host}-${r.createdAt.slice(0, 10)}${r.status === "partial" ? "-partial" : ""}.${ext}`;
}
