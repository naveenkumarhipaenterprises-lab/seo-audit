import "server-only";
import path from "node:path";
import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import type { AuditRecord, CheckResult, CheckStatus } from "../audit/types";
import { CATEGORY_LABELS } from "../audit/types";
import { prioritizedIssues } from "../scoring/score";
import { SEVERITY_WEIGHTS, STATUS_CREDIT } from "../scoring/weights";
import { APP_NAME, APP_TAGLINE } from "../config";

const C = {
  blue: "#1d4ed8", text: "#0f172a", muted: "#64748b", border: "#e2e8f0", soft: "#f8fafc",
  pass: "#15803d", warning: "#b45309", fail: "#b91c1c", info: "#1d4ed8", na: "#64748b",
};
const STATUS_LABEL: Record<CheckStatus, string> = { pass: "PASS", warning: "WARNING", fail: "FAIL", info: "INFO", not_applicable: "N/A", not_tested: "NOT TESTED" };
const STATUS_COLOR: Record<CheckStatus, string> = { pass: C.pass, warning: C.warning, fail: C.fail, info: C.info, not_applicable: C.na, not_tested: C.na };

let fonts: { regular: Buffer; bold: Buffer } | null = null;
function loadFonts() {
  if (!fonts) {
    const dir = path.join(/* turbopackIgnore: true */ process.cwd(), "assets", "fonts");
    fonts = { regular: readFileSync(path.join(dir, "DejaVuSans.ttf")), bold: readFileSync(path.join(dir, "DejaVuSans-Bold.ttf")) };
  }
  return fonts;
}

/** Lets long URLs wrap: PDFKit only breaks at spaces/soft breaks. */
const wrapUrl = (s: string) => s.replace(/([/?&=._-])/g, "$1​");
const fmtScore = (n: number | null) => (n === null ? "Not tested" : `${n}/100`);

export async function auditToPdf(r: AuditRecord): Promise<Buffer> {
  const f = loadFonts();
  const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 64, left: 50, right: 50 }, bufferPages: true, info: { Title: `${APP_NAME} audit — ${r.finalUrl}`, Author: APP_NAME, CreationDate: new Date(r.completedAt) } });
  doc.registerFont("R", f.regular);
  doc.registerFont("B", f.bold);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const h1 = (t: string) => {
    ensure(60);
    doc.moveDown(0.6).font("B").fontSize(16).fillColor(C.blue).text(t, L, doc.y, { width: W });
    doc.moveTo(L, doc.y + 3).lineTo(L + W, doc.y + 3).strokeColor(C.border).lineWidth(1).stroke();
    doc.moveDown(0.6);
  };
  const h2 = (t: string) => {
    ensure(40);
    doc.moveDown(0.4).font("B").fontSize(12).fillColor(C.text).text(t, L, doc.y, { width: W }).moveDown(0.25);
  };
  const p = (t: string, opts: { color?: string; size?: number; bold?: boolean } = {}) => {
    doc.font(opts.bold ? "B" : "R").fontSize(opts.size ?? 9.5).fillColor(opts.color ?? C.text);
    ensure(doc.heightOfString(t, { width: W }) + 4);
    doc.text(t, L, doc.y, { width: W, lineGap: 1.5 }).moveDown(0.3);
  };

  /** Table with wrapping cells, repeated header on page breaks and no overlap. */
  const table = (cols: { header: string; width: number; color?: (row: string[]) => string | undefined }[], rows: string[][]) => {
    const total = cols.reduce((s, c) => s + c.width, 0);
    const widths = cols.map((c) => (c.width / total) * W);
    const pad = 4;
    const drawHeader = () => {
      doc.font("B").fontSize(8.5);
      const hh = Math.max(...cols.map((c, i) => doc.heightOfString(c.header, { width: widths[i] - pad * 2 }))) + pad * 2;
      ensure(hh + 20);
      const y = doc.y;
      doc.rect(L, y, W, hh).fill(C.soft);
      let x = L;
      cols.forEach((c, i) => {
        doc.fillColor(C.muted).text(c.header, x + pad, y + pad, { width: widths[i] - pad * 2 });
        x += widths[i];
      });
      doc.y = y + hh;
    };
    drawHeader();
    for (const row of rows) {
      doc.font("R").fontSize(8.5);
      const cells = row.map((v) => (/^https?:\/\//.test(v) ? wrapUrl(v) : v));
      const rh = Math.max(...cells.map((v, i) => doc.heightOfString(v || " ", { width: widths[i] - pad * 2 }))) + pad * 2;
      if (doc.y + rh > bottom()) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      let x = L;
      cells.forEach((v, i) => {
        const color = cols[i].color?.(row);
        doc.font(color ? "B" : "R").fontSize(8.5).fillColor(color || C.text).text(v || "—", x + pad, y + pad, { width: widths[i] - pad * 2 });
        x += widths[i];
      });
      doc.moveTo(L, y + rh).lineTo(L + W, y + rh).strokeColor(C.border).lineWidth(0.5).stroke();
      doc.y = y + rh;
      doc.x = L;
    }
    doc.moveDown(0.6);
  };
  const statusCol = (idx: number) => (row: string[]) => {
    const st = (Object.keys(STATUS_LABEL) as CheckStatus[]).find((k) => STATUS_LABEL[k] === row[idx]);
    return st ? STATUS_COLOR[st] : undefined;
  };
  const checkTable = (list: CheckResult[]) => {
    if (!list.length) return p("No checks in this section.", { color: C.muted });
    table(
      [{ header: "Check", width: 21 }, { header: "Status", width: 14, color: statusCol(1) }, { header: "Severity", width: 12 }, { header: "Finding and evidence", width: 53 }],
      list.map((c) => [c.title, STATUS_LABEL[c.status], c.severity, [c.explanation, c.evidence.slice(0, 5).join("\n"), c.status === "fail" || c.status === "warning" ? `Fix: ${c.recommendation}` : "", c.limitation ? `Limitation: ${c.limitation}` : ""].filter(Boolean).join("\n")]),
    );
  };
  const byGroup = (cat: CheckResult["category"], groups?: string[]) => r.checks.filter((c) => c.category === cat && (!groups || groups.includes(c.group)));

  // 1-2. Cover
  doc.rect(0, 0, doc.page.width, 8).fill(C.blue);
  doc.font("B").fontSize(26).fillColor(C.blue).text(APP_NAME, L, 140, { width: W });
  doc.font("R").fontSize(11).fillColor(C.muted).text(APP_TAGLINE, { width: W }).moveDown(2);
  doc.font("B").fontSize(20).fillColor(C.text).text("Website Visibility Audit", { width: W }).moveDown(0.6);
  doc.font("R").fontSize(11).fillColor(C.text).text(wrapUrl(r.finalUrl), { width: W });
  if (r.finalUrl !== r.requestedUrl) doc.fontSize(9).fillColor(C.muted).text(`Requested: ${wrapUrl(r.requestedUrl)}`, { width: W });
  doc.moveDown(0.6).fontSize(10).fillColor(C.muted).text(`Audit date: ${new Date(r.completedAt).toUTCString()}`, { width: W });
  doc.text(`Methodology version: ${r.scores.methodologyVersion}   ·   Pages crawled: ${r.pagesCrawled}`, { width: W });
  if (r.status === "partial") {
    doc.moveDown(1).font("B").fontSize(11).fillColor(C.warning).text("PARTIAL REPORT: some analyses were not completed. See \"Limitations and unavailable data\".", { width: W });
  }
  doc.moveDown(3);
  const boxes: [string, number | null][] = [["Overall visibility", r.scores.overall.score], ["SEO", r.scores.seo.score], ["AEO", r.scores.categories.aeo.score], ["GEO", r.scores.categories.geo.score]];
  const bw = (W - 30) / 4;
  const by = doc.y;
  boxes.forEach(([label, v], i) => {
    const x = L + i * (bw + 10);
    doc.roundedRect(x, by, bw, 74, 6).strokeColor(C.border).lineWidth(1).stroke();
    doc.font("B").fontSize(v === null ? 12 : 24).fillColor(v === null ? C.muted : v >= 80 ? C.pass : v >= 50 ? C.warning : C.fail).text(v === null ? "Not tested" : String(v), x, by + 14, { width: bw, align: "center" });
    doc.font("R").fontSize(9).fillColor(C.muted).text(label, x, by + 50, { width: bw, align: "center" });
  });
  doc.y = by + 100;
  doc.x = L;
  p("Scores represent this application's diagnostic model. They are not official Google, ChatGPT or other search engine scores.", { color: C.muted, size: 8.5 });

  // 3-4. Scores
  doc.addPage();
  h1("Scores");
  table(
    [{ header: "Category", width: 40 }, { header: "Score", width: 15 }, { header: "Points earned / possible", width: 25 }, { header: "Pass / Warn / Fail / Not tested", width: 30 }],
    Object.values(r.scores.categories).map((c) => [c.label, fmtScore(c.score), c.category === "performance" ? "Lighthouse score (mean of tested strategies)" : `${c.earned} / ${c.possible}`, `${c.counts.pass} / ${c.counts.warning} / ${c.counts.fail} / ${c.counts.not_tested}`]),
  );
  h2("Overall Visibility Score");
  table(
    [{ header: "Component", width: 30 }, { header: "Score", width: 20 }, { header: "Configured weight", width: 20 }, { header: "Effective weight", width: 15 }, { header: "Contribution", width: 15 }],
    r.scores.overall.components.map((c) => [c.name, fmtScore(c.score), `${c.weight}%`, `${c.effectiveWeight}%`, c.contribution === null ? "—" : String(c.contribution)]),
  );
  h2("SEO score composition");
  table(
    [{ header: "Component", width: 40 }, { header: "Score", width: 20 }, { header: "Weight", width: 20 }, { header: "Contribution", width: 20 }],
    r.scores.seo.components.map((c) => [CATEGORY_LABELS[c.category], fmtScore(c.score), String(c.weight), c.contribution === null ? "—" : String(c.contribution)]),
  );

  // 5. Methodology
  h1("Scoring methodology and limitations");
  p(r.scores.overall.formula);
  p(`Each check is worth points by severity (critical ${SEVERITY_WEIGHTS.critical}, high ${SEVERITY_WEIGHTS.high}, medium ${SEVERITY_WEIGHTS.medium}, low ${SEVERITY_WEIGHTS.low}). Pass earns ${STATUS_CREDIT.pass * 100}%, warning ${STATUS_CREDIT.warning * 100}%, fail ${STATUS_CREDIT.fail * 100}%. Not applicable, informational and not-tested checks are excluded from the denominator. Each check belongs to exactly one category, so no issue is scored twice. Performance uses the Lighthouse performance score directly.`);
  p("Length, count and structure guidance is diagnostic. It is not a statement about Google ranking penalties.", { color: C.muted });

  // 6. Executive summary
  h1("Executive summary");
  const t = r.scores.totals;
  p(`${APP_NAME} ran ${r.checks.length} checks on ${r.finalUrl}: ${t.passed} passed, ${t.warnings} warnings, ${t.errors} errors (${t.critical} critical, ${t.high} high severity) and ${t.notTested} not tested.`);
  p(`The page returned HTTP ${r.httpStatus}${r.redirects.length ? ` after ${r.redirects.length} redirect(s)` : ""}, in ${r.responseTimeMs} ms, with ${r.page?.mainWordCount ?? 0} words of main content, ${r.images.length} images and ${r.links.internal} internal links.`);
  const top = prioritizedIssues(r.checks).slice(0, 5);
  if (top.length) p(`Top priorities: ${top.map((c) => c.title).join("; ")}.`);

  // 7. Critical & high
  h1("Critical errors and high-priority warnings");
  checkTable(prioritizedIssues(r.checks).filter((c) => c.severity === "critical" || c.severity === "high"));

  // 8-10. Technical
  h1("Technical SEO results");
  checkTable(byGroup("technical", ["HTTP & security", "Links", "Structured data"]));
  h1("Metadata and headings");
  if (r.page) {
    table([{ header: "Field", width: 25 }, { header: "Value", width: 75 }], [
      ["Title", r.page.title ?? "Missing"], ["Meta description", r.page.metaDescription ?? "Missing"], ["Canonical", r.page.canonical ?? "Missing"],
      ["Meta robots", r.page.robotsMeta.join("; ") || "None"], ["X-Robots-Tag", r.page.xRobotsTag ?? "None"], ["Language", r.page.lang ?? "Not set"], ["Viewport", r.page.viewport ?? "Missing"],
      ["H1", r.page.headings.filter((h) => h.level === 1).map((h) => h.text).join(" | ") || "Missing"],
    ]);
    if (r.page.headings.length) {
      h2("Heading outline");
      table([{ header: "Level", width: 10 }, { header: "Text", width: 90 }], r.page.headings.slice(0, 60).map((h) => [`H${h.level}`, h.text || "(empty)"]));
    }
  }
  checkTable(byGroup("technical", ["Metadata", "Headings"]));
  h1("Canonical and indexability analysis");
  p("Google indexing status not verified — connect Google Search Console.", { bold: true, color: C.warning });
  checkTable(byGroup("technical", ["Indexability"]));

  // 11. Images
  h1("Image URLs and ALT analysis");
  checkTable(byGroup("images"));
  if (r.images.length) {
    table(
      [{ header: "Image URL", width: 46 }, { header: "ALT", width: 24 }, { header: "Status", width: 8 }, { header: "Size", width: 10 }, { header: "Dimensions", width: 12 }],
      r.images.slice(0, 150).map((i) => [i.src, i.altState === "missing" ? "MISSING" : i.altState === "empty" ? '(empty alt="")' : i.alt || "", i.probe?.status ? String(i.probe.status) : i.probe?.unverified ? "Unverified" : i.probe?.error ? "Error" : "Not checked", i.probe?.bytes ? `${Math.round(i.probe.bytes / 1024)} KB` : "—", i.probe?.width ? `${i.probe.width}×${i.probe.height}` : "—"]),
    );
    if (r.images.length > 150) p(`…and ${r.images.length - 150} more images (see CSV export).`, { color: C.muted });
  }

  // 12. Keyword
  h1("Keyword and content analysis");
  if (r.keyword) {
    p(`Primary keyword: "${r.keyword.primary}". ${r.keyword.occurrences} occurrence(s), about ${r.keyword.density}% of main-content words.`);
    table([{ header: "Location", width: 50 }, { header: "Found", width: 50 }], r.keyword.placements.map((pl) => [pl.location, pl.found ? `Yes${pl.detail ? ` (${pl.detail})` : ""}` : "No"]));
    p(`Unavailable without a connected data source: ${r.keyword.unavailable.join(", ")}.`, { color: C.muted });
  } else p("No target keyword was entered for this audit.", { color: C.muted });
  checkTable(byGroup("content"));

  // 13-14. AEO / GEO
  h1("AEO readiness findings");
  checkTable(byGroup("aeo"));
  if (r.suggestions.questions.length || r.suggestions.answerBlocks.length) {
    h2("Suggested questions and answer blocks");
    p(r.suggestions.note, { color: C.muted, size: 8.5 });
    [...r.suggestions.questions, ...r.suggestions.answerBlocks].forEach((q) => p(`• ${q}`));
  }
  h1("GEO readiness findings");
  p("A technical crawl cannot establish whether ChatGPT, Gemini, Perplexity or other AI systems mention or cite this brand. No AI visibility figures are estimated.", { color: C.muted });
  checkTable(byGroup("geo"));
  h2("Crawler access per robots.txt");
  table(
    [{ header: "Crawler token", width: 22 }, { header: "Operator", width: 15 }, { header: "robots.txt for this URL", width: 18 }, { header: "Purpose", width: 45 }],
    r.aiCrawlers.map((a) => [a.agent, a.operator, a.allowed === null ? "Not evaluated" : a.allowed ? `Allowed${a.hasGroup ? " (own rules)" : ""}` : `Disallowed${a.hasGroup ? " (own rules)" : ""}`, a.purpose]),
  );

  // 15-16. Mobile / performance
  h1("Mobile responsiveness results");
  checkTable(byGroup("mobile"));
  if (r.render.viewports.length) {
    table(
      [{ header: "Viewport", width: 20 }, { header: "Horizontal overflow", width: 20 }, { header: "Small text", width: 20 }, { header: "Small tap targets", width: 20 }, { header: "Wide images", width: 20 }],
      r.render.viewports.map((v) => [`${v.name} ${v.width}px`, v.horizontalOverflow ? `Yes (${v.scrollWidth}px)` : "No", `${Math.round(v.smallTextRatio * 100)}%`, `${v.smallTapTargets}/${v.tapTargetsChecked}`, String(v.imagesWiderThanViewport)]),
    );
  }
  h1("Mobile and desktop performance metrics");
  for (const perf of r.performance) {
    h2(`${perf.strategy === "mobile" ? "Mobile" : "Desktop"}: ${perf.status === "ok" ? `${perf.score}/100` : "Not tested"}`);
    if (perf.status !== "ok") {
      p(perf.error || "Not tested.", { color: C.muted });
      continue;
    }
    table([{ header: "Lab metric (Lighthouse)", width: 50 }, { header: "Value", width: 50 }], Object.entries(perf.lab).map(([k, v]) => [k, v.display ?? "Unavailable"]));
    if (perf.field.source === "none") p("Field data (Chrome UX Report): unavailable for this URL and origin. INP is not reported.", { color: C.muted });
    else table([{ header: `Field metric (CrUX, ${perf.field.source}-level, p75)`, width: 50 }, { header: "Value / rating", width: 50 }], Object.entries(perf.field.metrics).map(([k, m]) => [k, `${m.p75 ?? "n/a"}${k === "CLS" ? "" : " ms"} (${m.category ?? "n/a"})`]));
  }
  checkTable(byGroup("performance").filter((c) => c.id.startsWith("perf-score")));

  // 17. Affected URLs
  h1("Affected URL list");
  const affected = new Map<string, string[]>();
  for (const c of r.checks.filter((c) => c.status === "fail" || c.status === "warning")) {
    for (const e of c.evidence) {
      const m = e.match(/https?:\/\/\S+/);
      if (m) affected.set(m[0], [...(affected.get(m[0]) || []), c.title]);
    }
    affected.set(c.url, [...(affected.get(c.url) || []), c.title]);
  }
  table([{ header: "URL", width: 55 }, { header: "Issues", width: 45 }], Array.from(affected.entries()).slice(0, 200).map(([u, ts]) => [u, Array.from(new Set(ts)).join(", ")]));

  // 18. Priority fixes
  h1("Recommended fixes in priority order");
  table(
    [{ header: "#", width: 5 }, { header: "Issue", width: 25 }, { header: "Severity", width: 10 }, { header: "Recommended fix", width: 60 }],
    prioritizedIssues(r.checks).map((c, i) => [String(i + 1), c.title, c.severity, c.recommendation]),
  );

  // 19. Limitations
  h1("Limitations and unavailable data");
  r.limitations.forEach((l) => p(`• ${l}`));
  table([{ header: "Integration", width: 40 }, { header: "Status", width: 60 }], [
    ["PageSpeed Insights", r.integrations.pagespeed], ["Google Search Console", r.integrations.searchConsole], ["Browser rendering", r.integrations.rendering], ["AI provider", r.integrations.ai], ["Keyword data provider", r.integrations.keywordData],
  ]);

  // Footer with page numbers on every page.
  const range = doc.bufferedPageRange();
  const generated = new Date().toISOString().slice(0, 10);
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 40;
    const m = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("R").fontSize(7.5).fillColor(C.muted);
    doc.text(`${APP_NAME} · ${r.finalUrl.length > 70 ? r.finalUrl.slice(0, 69) + "…" : r.finalUrl} · Generated ${generated}${r.status === "partial" ? " · PARTIAL" : ""}`, L, y, { width: W - 60, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, L + W - 60, y, { width: 60, align: "right", lineBreak: false });
    doc.page.margins.bottom = m;
  }
  doc.end();
  return done;
}
