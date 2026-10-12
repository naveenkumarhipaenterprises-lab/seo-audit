import type { AuditRecord } from "../audit/types";
import { CATEGORY_LABELS, SOURCE_LABELS } from "../audit/types";
import { sourceOf, statusLabel } from "../audit/record-utils";

/** RFC 4180 field quoting, plus a guard against spreadsheet formula injection. */
export function csvField(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (cells: unknown[]) => cells.map(csvField).join(",");

/** One row per check, then images, pages (Full Site mode) and scores. Generated only from the stored record. */
export function auditToCsv(r: AuditRecord): string {
  const lines: string[] = [];
  lines.push(row(["Section", "Category", "Group", "Check ID", "Check", "Status", "Severity", "Affected URL", "Affected URLs count", "All affected URLs", "Evidence", "Explanation", "Recommended fix", "Detection method", "Limitation", "Source", "Issue status", "Detected at"]));
  for (const c of r.checks) {
    const urls = c.affectedUrls?.length ? c.affectedUrls : [c.url];
    const isIssue = c.status === "fail" || c.status === "warning";
    const state = r.issueStates?.[c.id];
    lines.push(row(["Check", CATEGORY_LABELS[c.category], c.group, c.id, c.title, c.status, c.severity, c.url, urls.length, urls.join(" | "), c.evidence.join(" | "), c.explanation, c.recommendation, c.detection, c.limitation || "", SOURCE_LABELS[sourceOf(c)], isIssue ? (state === "ignored" ? "Ignored" : state === "not_applicable" ? "Not applicable" : "Open") : "", c.detectedAt || r.completedAt]));
  }
  lines.push("");
  lines.push(row(["Section", "Image URL", "Source page", "ALT state", "ALT text", "HTTP status", "Content type", "Bytes", "Width", "Height", "Format", "Width attr", "Height attr", "Loading", "Probe error"]));
  for (const i of r.images) {
    lines.push(row(["Image", i.src, i.sourcePage, i.altState, i.alt ?? "", i.probe?.status ?? "", i.probe?.contentType ?? "", i.probe?.bytes ?? "", i.probe?.width ?? "", i.probe?.height ?? "", i.probe?.format ?? "", i.widthAttr ?? "", i.heightAttr ?? "", i.loading ?? "", i.probe?.error ?? (i.probe ? "" : "not checked")]));
  }
  if (r.pages?.length) {
    lines.push("");
    lines.push(row(["Section", "URL", "Final URL", "HTTP status", "Depth", "Found via", "Redirects", "Response ms", "Title", "Meta description", "H1", "H1 count", "Canonical", "noindex", "Indexability signals", "Words", "Inlinks", "Internal links out", "Images", "Images missing ALT", "Issues", "Error"]));
    for (const pg of r.pages) {
      lines.push(row(["Page", pg.url, pg.finalUrl, pg.status ?? "", pg.depth, pg.foundVia, pg.redirects, pg.responseMs ?? "", pg.title ?? "", pg.description ?? "", pg.h1 ?? "", pg.h1Count, pg.canonical ?? "", pg.noindex ? "yes" : "no", pg.indexable === null ? "unknown" : pg.indexable ? "indexable" : "not indexable", pg.wordCount, pg.inlinks, pg.internalLinksOut, pg.images, pg.imagesMissingAlt, pg.issues.join(" | "), pg.error ?? ""]));
    }
  }
  lines.push("");
  lines.push(row(["Section", "Audit", "Value"]));
  lines.push(row(["Audit", "URL", r.finalUrl]));
  lines.push(row(["Audit", "Mode", r.input.mode === "full" ? "Full Site Audit" : "Quick Audit"]));
  lines.push(row(["Audit", "Status", statusLabel(r.status)]));
  lines.push(row(["Audit", "Started", r.createdAt]));
  lines.push(row(["Audit", "Completed", r.completedAt]));
  lines.push(row(["Audit", "Pages analysed", r.pages?.filter((p) => !p.error).length || r.pagesCrawled]));
  lines.push(row(["Audit", "Engine version", r.engineVersion || ""]));
  lines.push("");
  lines.push(row(["Section", "Score", "Value", "Methodology version"]));
  lines.push(row(["Score", "Overall audit health", r.scores.overall.score ?? "Not tested", r.scores.methodologyVersion]));
  lines.push(row(["Score", "SEO", r.scores.seo.score ?? "Not tested", r.scores.methodologyVersion]));
  for (const c of Object.values(r.scores.categories)) lines.push(row(["Score", c.label, c.score ?? "Not tested", r.scores.methodologyVersion]));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
