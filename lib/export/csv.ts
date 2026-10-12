import type { AuditRecord } from "../audit/types";
import { CATEGORY_LABELS } from "../audit/types";

/** RFC 4180 field quoting, plus a guard against spreadsheet formula injection. */
export function csvField(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (cells: unknown[]) => cells.map(csvField).join(",");

/** One row per check, followed by an image section. Generated only from the stored record. */
export function auditToCsv(r: AuditRecord): string {
  const lines: string[] = [];
  lines.push(row(["Section", "Category", "Group", "Check ID", "Check", "Status", "Severity", "Affected URL", "Evidence", "Explanation", "Recommended fix", "Detection method", "Limitation"]));
  for (const c of r.checks) {
    lines.push(row(["Check", CATEGORY_LABELS[c.category], c.group, c.id, c.title, c.status, c.severity, c.url, c.evidence.join(" | "), c.explanation, c.recommendation, c.detection, c.limitation || ""]));
  }
  lines.push("");
  lines.push(row(["Section", "Image URL", "Source page", "ALT state", "ALT text", "HTTP status", "Content type", "Bytes", "Width", "Height", "Format", "Width attr", "Height attr", "Loading", "Probe error"]));
  for (const i of r.images) {
    lines.push(row(["Image", i.src, i.sourcePage, i.altState, i.alt ?? "", i.probe?.status ?? "", i.probe?.contentType ?? "", i.probe?.bytes ?? "", i.probe?.width ?? "", i.probe?.height ?? "", i.probe?.format ?? "", i.widthAttr ?? "", i.heightAttr ?? "", i.loading ?? "", i.probe?.error ?? (i.probe ? "" : "not checked")]));
  }
  lines.push("");
  lines.push(row(["Section", "Score", "Value", "Methodology version"]));
  lines.push(row(["Score", "Overall visibility", r.scores.overall.score ?? "Not tested", r.scores.methodologyVersion]));
  lines.push(row(["Score", "SEO", r.scores.seo.score ?? "Not tested", r.scores.methodologyVersion]));
  for (const c of Object.values(r.scores.categories)) lines.push(row(["Score", c.label, c.score ?? "Not tested", r.scores.methodologyVersion]));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
