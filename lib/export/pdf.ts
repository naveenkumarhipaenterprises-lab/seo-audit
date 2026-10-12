import "server-only";
import path from "node:path";
import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import type { AuditRecord, Category, CheckResult, CheckStatus } from "../audit/types";
import { CATEGORY_LABELS, SOURCE_LABELS } from "../audit/types";
import { sourceOf, statusLabel } from "../audit/record-utils";
import { SNAPSHOT_CATEGORIES } from "../audit/snapshot-categories";
import { prioritizedIssues } from "../scoring/score";
import { OVERALL_WEIGHTS, SCORE_NOTICE, SEO_COMPONENT_WEIGHTS, SEVERITY_WEIGHTS, STATUS_CREDIT } from "../scoring/weights";
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
const STOP_REASON: Record<string, string> = {
  complete: "every discoverable page within the limits was processed",
  page_limit: "the maximum page limit was reached",
  time_budget: "the crawl time budget was reached",
  cancelled: "the audit was cancelled",
  not_run: "the crawl did not run",
};
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

  const t = r.scores.totals;
  const full = r.input.mode === "full";
  const pagesAnalysed = r.pages?.filter((x) => !x.error).length || r.pagesCrawled;
  const tested = t.tested ?? t.passed + t.warnings + t.errors;
  const notApplicable = t.notApplicable ?? r.checks.filter((c) => c.status === "not_applicable").length;
  const partial = r.status === "partial";
  const when = (iso: string) => new Date(iso).toUTCString();

  // 1-3. Cover: product, URL, audit date
  doc.rect(0, 0, doc.page.width, 8).fill(C.blue);
  doc.font("B").fontSize(26).fillColor(C.blue).text(APP_NAME, L, 140, { width: W });
  doc.font("R").fontSize(11).fillColor(C.muted).text(APP_TAGLINE, { width: W }).moveDown(2);
  doc.font("B").fontSize(20).fillColor(C.text).text(full ? "Full Site Audit Report" : "Quick Audit Report", { width: W }).moveDown(0.6);
  doc.font("R").fontSize(11).fillColor(C.text).text(wrapUrl(r.finalUrl), { width: W });
  if (r.finalUrl !== r.requestedUrl) doc.fontSize(9).fillColor(C.muted).text(`Requested: ${wrapUrl(r.requestedUrl)}`, { width: W });
  doc.moveDown(0.6).fontSize(10).fillColor(C.muted).text(`Audit started: ${when(r.createdAt)}`, { width: W });
  doc.text(`Audit completed: ${when(r.completedAt)}`, { width: W });
  doc.text(`Status: ${statusLabel(r.status)}   ·   Pages analysed: ${pagesAnalysed}`, { width: W });
  doc.text(`Methodology ${r.scores.methodologyVersion}${r.engineVersion ? `   ·   Engine ${r.engineVersion}` : ""}`, { width: W });
  if (partial) doc.moveDown(1).font("B").fontSize(11).fillColor(C.warning).text("PARTIALLY COMPLETED REPORT: some analyses did not finish. See \"Data sources and limitations\".", { width: W });
  else if (r.status === "completed_with_warnings") doc.moveDown(1).font("B").fontSize(11).fillColor(C.warning).text("COMPLETED WITH WARNINGS: see \"Data sources and limitations\".", { width: W });
  doc.moveDown(3);
  const boxes: [string, number | null][] = [["Overall health", r.scores.overall.score], ["SEO", r.scores.seo.score], ["AEO readiness", r.scores.categories.aeo.score], ["GEO readiness", r.scores.categories.geo.score]];
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
  p(SCORE_NOTICE, { color: C.muted, size: 8.5 });

  // 4. Audit configuration
  doc.addPage();
  h1("Audit configuration");
  const inp = r.input;
  table([{ header: "Setting", width: 30 }, { header: "Value", width: 70 }], [
    ["Mode", full ? `Full Site Audit (max ${inp.maxPages} pages, depth ${inp.maxDepth})` : "Quick Audit (single page)"],
    ["Primary keyword", inp.primaryKeyword || "None"],
    ["Secondary keywords", (inp.secondaryKeywords ?? []).join(", ") || "None"],
    ["Competitor URLs", (inp.competitorUrls ?? []).join(", ") || "None"],
    ["Business details", [inp.businessName, inp.businessLocation, inp.businessType].filter(Boolean).join(" · ") || "Not provided"],
    ["Performance test", inp.runPerformance ? `PageSpeed Insights, ${inp.performanceStrategy}` : "Off"],
    ["Browser rendering", inp.renderJs ? "Requested" : "Off"],
    ["robots.txt", inp.respectRobots ? "Respected" : "Not respected (site-owner override)"],
    ["External link checks", inp.checkExternalLinks ? "On" : "Off"],
    ["Search Console", inp.useSearchConsole ? "Requested" : "Not used"],
  ]);

  // 5. Executive overview
  h1("Executive overview");
  p(`${APP_NAME} ran ${r.checks.length} checks on ${pagesAnalysed} page(s) of ${r.finalUrl}: ${t.passed} passed, ${t.warnings} warnings, ${t.errors} failed (${t.critical} critical, ${t.high} high severity), ${t.notTested} skipped or not tested and ${notApplicable} not applicable.`);
  p(`The start page returned HTTP ${r.httpStatus ?? "—"}${r.redirects.length ? ` after ${r.redirects.length} redirect(s)` : ""}${r.responseTimeMs !== null ? ` in ${r.responseTimeMs} ms` : ""}, with ${r.page?.mainWordCount ?? 0} words of main content, ${r.images.length} images${full ? " across crawled pages" : ""} and ${r.links.internal} internal links.`);
  const top = prioritizedIssues(r.checks).slice(0, 5);
  if (top.length) p(`Top priorities: ${top.map((c) => c.title).join("; ")}.`);
  else p("No failed or warning checks were found.");

  // 6. Scores
  h1("Overall and category scores");
  table(
    [{ header: "Category", width: 34 }, { header: "Score", width: 16 }, { header: "Points earned / possible", width: 22 }, { header: "Pass / Warn / Fail / Skipped / N/A", width: 28 }],
    Object.values(r.scores.categories).map((c) => [c.label, fmtScore(c.score), c.category === "performance" ? "Lighthouse score (mean of tested strategies)" : `${c.earned} / ${c.possible}`, `${c.counts.pass} / ${c.counts.warning} / ${c.counts.fail} / ${c.counts.not_tested} / ${c.counts.not_applicable ?? 0}`]),
  );
  h2("Overall audit health");
  table(
    [{ header: "Component", width: 30 }, { header: "Score", width: 20 }, { header: "Configured weight", width: 20 }, { header: "Effective weight", width: 15 }, { header: "Contribution", width: 15 }],
    r.scores.overall.components.map((c) => [c.name, fmtScore(c.score), `${c.weight}%`, `${c.effectiveWeight}%`, c.contribution === null ? "—" : String(c.contribution)]),
  );
  h2("SEO score composition");
  table(
    [{ header: "Component", width: 40 }, { header: "Score", width: 20 }, { header: "Weight", width: 20 }, { header: "Contribution", width: 20 }],
    r.scores.seo.components.map((c) => [CATEGORY_LABELS[c.category], fmtScore(c.score), String(c.weight), c.contribution === null ? "—" : String(c.contribution)]),
  );
  if (r.competitors?.length) {
    h2("Competitor comparison (same reduced check set, home pages fetched once)");
    const cols = [r.siteSnapshot, ...r.competitors].filter(Boolean) as NonNullable<AuditRecord["siteSnapshot"]>[];
    table(
      [{ header: "Site", width: 30 }, ...SNAPSHOT_CATEGORIES.slice(0, 6).map((c) => ({ header: CATEGORY_LABELS[c], width: 70 / 6 }))],
      cols.map((s, i) => [i === 0 && r.siteSnapshot ? `This site (${s.url})` : s.url, ...SNAPSHOT_CATEGORIES.slice(0, 6).map((c) => (s.status === "ok" ? fmtScore(s.scores[c] ?? null) : s.status === "blocked" ? "Not fetched" : "Error"))]),
    );
    p("No traffic, ranking or backlink data is estimated for competitors.", { color: C.muted, size: 8.5 });
  }

  // 7. Pages analysed
  h1("Pages analysed");
  if (r.crawl?.enabled) {
    p(`Discovered ${r.crawl.discovered} URL(s); processed ${r.crawl.processed}; failed ${r.crawl.failed}; skipped by robots.txt ${r.crawl.skippedRobots}; sitemap seeds used ${r.crawl.sitemapUrlsUsed}. Crawl stopped because: ${STOP_REASON[r.crawl.stopReason] ?? r.crawl.stopReason}. Duration ${Math.round(r.crawl.durationMs / 1000)} s.`);
  } else p(`Quick Audit: ${pagesAnalysed} page analysed (the submitted URL).`);
  if (r.pages?.length) {
    table(
      [{ header: "URL", width: 40 }, { header: "Status", width: 8 }, { header: "Depth", width: 7 }, { header: "Words", width: 8 }, { header: "Indexability signals", width: 14 }, { header: "Issues", width: 23 }],
      r.pages.slice(0, 200).map((pg) => [pg.finalUrl, pg.error ? (pg.error.startsWith("Blocked by robots") ? "Not fetched" : "Error") : String(pg.status ?? "—"), String(pg.depth), String(pg.wordCount), pg.indexable === null ? "Unknown" : pg.indexable ? "Indexable" : pg.noindex ? "noindex" : "Not indexable", pg.error || pg.issues.slice(0, 4).join("; ") || "—"]),
    );
    if (r.pages.length > 200) p(`…and ${r.pages.length - 200} more pages (see CSV export).`, { color: C.muted });
  }

  // 8. Passed and failed checks
  h1("Passed and failed checks");
  table([{ header: "Result", width: 50 }, { header: "Checks", width: 50 }], [
    ["Tested (pass + warning + fail)", String(tested)], ["Passed", String(t.passed)], ["Warnings", String(t.warnings)], ["Failed", String(t.errors)],
    ["Skipped / not tested", String(t.notTested)], ["Not applicable", String(notApplicable)], ["Informational", String(t.info ?? r.checks.filter((c) => c.status === "info").length)],
  ]);
  const passed = r.checks.filter((c) => c.status === "pass");
  if (passed.length) p(`Passed: ${passed.map((c) => c.title).join("; ")}.`, { size: 8.5, color: C.muted });

  // 9. Critical & high
  h1("Critical and high-priority issues");
  checkTable(prioritizedIssues(r.checks).filter((c) => c.severity === "critical" || c.severity === "high"));

  // 10. Technical SEO
  h1("Technical SEO results");
  checkTable(r.checks.filter((c) => c.category === "technical" && c.group !== "Indexability"));
  h2("Accessibility (automated HTML checks)");
  checkTable(byGroup("accessibility"));
  h2("Security headers and HTTPS");
  if (r.security) {
    table([{ header: "Header / check", width: 35 }, { header: "Observed value", width: 65 }], [
      ["HTTP → HTTPS", r.security.httpRedirectsToHttps === null ? (r.security.httpRefused ? "Plain HTTP is not served" : "Not determined") : r.security.httpRedirectsToHttps ? "Redirects to HTTPS" : "Does not redirect"],
      ...Object.entries(r.security.headers).map(([k, v]) => [k, v ? (v.length > 200 ? v.slice(0, 199) + "…" : v) : "Not set"]),
    ]);
  }
  checkTable(byGroup("security"));
  p("These are limited public checks, not a security assessment or penetration test.", { color: C.muted, size: 8.5 });

  // 11. Metadata and indexability
  h1("Metadata and indexability findings");
  if (r.page) {
    table([{ header: "Field (start page)", width: 25 }, { header: "Value", width: 75 }], [
      ["Title", r.page.title ?? "Missing"], ["Meta description", r.page.metaDescription ?? "Missing"], ["Canonical", r.page.canonical ?? "Missing"],
      ["Meta robots", r.page.robotsMeta.join("; ") || "None"], ["X-Robots-Tag", r.page.xRobotsTag ?? "None"], ["Language", r.page.lang ?? "Not set"],
      ["Charset", r.page.charset ?? "Not declared"], ["Viewport", r.page.viewport ?? "Missing"],
      ["H1", r.page.headings.filter((h) => h.level === 1).map((h) => h.text).join(" | ") || "Missing"],
    ]);
    if (r.page.headings.length) {
      h2("Heading outline");
      table([{ header: "Level", width: 10 }, { header: "Text", width: 90 }], r.page.headings.slice(0, 60).map((h) => [`H${h.level}`, h.text || "(empty)"]));
    }
  }
  checkTable(byGroup("onpage"));
  h2("Indexability");
  const gsc = r.searchConsole;
  if (gsc?.status === "ok") {
    p(`Google Search Console property ${gsc.property}, ${gsc.dateRange ? `${gsc.dateRange.start} to ${gsc.dateRange.end}` : ""}, retrieved ${gsc.retrievedAt ? when(gsc.retrievedAt) : "—"}.`);
    if (gsc.totals) p(`Property totals: ${gsc.totals.clicks} clicks, ${gsc.totals.impressions} impressions, CTR ${(gsc.totals.ctr * 100).toFixed(1)}%, average position ${gsc.totals.position.toFixed(1)}.`);
    if (gsc.inspection && !gsc.inspection.error) p(`URL Inspection: ${gsc.inspection.verdict ?? "—"}${gsc.inspection.coverageState ? `, ${gsc.inspection.coverageState}` : ""}${gsc.inspection.lastCrawlTime ? `, last crawled ${when(gsc.inspection.lastCrawlTime)}` : ""}.`);
  } else {
    p(`Not verified through Search Console. ${gsc?.message || ""}`.trim(), { bold: true, color: C.warning });
    p("HTTP 200 and the absence of noindex are indexability signals only; they do not show whether Google has indexed the page.", { color: C.muted, size: 8.5 });
  }
  checkTable(byGroup("technical", ["Indexability"]));

  // 12. Images
  h1("Image audit");
  checkTable(byGroup("images"));
  if (r.images.length) {
    table(
      [{ header: "Image URL", width: 34 }, { header: "Page", width: 22 }, { header: "ALT", width: 18 }, { header: "Status", width: 8 }, { header: "Type / size", width: 18 }],
      r.images.slice(0, 150).map((i) => [i.src, i.sourcePage, i.altState === "missing" ? "MISSING" : i.altState === "empty" ? '(empty alt="")' : i.alt || "", i.probe?.status ? String(i.probe.status) : i.probe?.unverified ? "Unverified" : i.probe?.error ? "Error" : "Not checked", [i.probe?.format || i.probe?.contentType?.replace("image/", ""), i.probe?.bytes ? `${Math.round(i.probe.bytes / 1024)} KB` : null].filter(Boolean).join(", ") || "—"]),
    );
    if (r.images.length > 150) p(`…and ${r.images.length - 150} more images (see CSV export).`, { color: C.muted });
  }

  // 13. Content and keywords
  h1("Content and on-page keyword findings");
  if (r.keyword) {
    p(`Primary keyword: "${r.keyword.primary}". ${r.keyword.occurrences} occurrence(s), about ${r.keyword.density}% of main-content words on the start page.`);
    table([{ header: "Location", width: 50 }, { header: "Found", width: 50 }], r.keyword.placements.map((pl) => [pl.location, pl.found ? `Yes${pl.detail ? ` (${pl.detail})` : ""}` : "No"]));
    p(`Unavailable without a connected keyword data provider: ${r.keyword.unavailable.join(", ")}.`, { color: C.muted });
  } else p("No target keyword was entered for this audit.", { color: C.muted });
  checkTable(byGroup("content"));

  // 14. AEO
  h1("AEO readiness assessment");
  p("The AEO score is this tool's assessment of answer readiness from page structure and content. It does not show whether any answer engine uses the page.", { color: C.muted });
  checkTable(byGroup("aeo"));
  if (r.suggestions.questions.length || r.suggestions.answerBlocks.length) {
    h2("Suggested questions and answer blocks");
    p(r.suggestions.note, { color: C.muted, size: 8.5 });
    [...r.suggestions.questions, ...r.suggestions.answerBlocks].forEach((q) => p(`• ${q}`));
  }

  // 15. GEO
  h1("GEO readiness assessment");
  p("A technical crawl cannot establish whether ChatGPT, Gemini, Perplexity or other AI systems mention or cite this brand. No AI visibility figures or citations are estimated.", { color: C.muted });
  checkTable(byGroup("geo"));
  h2("Crawler access per robots.txt");
  table(
    [{ header: "Crawler token", width: 22 }, { header: "Operator", width: 15 }, { header: "robots.txt for this URL", width: 18 }, { header: "Purpose", width: 45 }],
    r.aiCrawlers.map((a) => [a.agent, a.operator, a.allowed === null ? "Not evaluated" : a.allowed ? `Allowed${a.hasGroup ? " (own rules)" : ""}` : `Disallowed${a.hasGroup ? " (own rules)" : ""}`, a.purpose]),
  );

  // 16. Performance and mobile
  h1("Performance results and source");
  p("Source: Google PageSpeed Insights API (Lighthouse lab data, plus Chrome UX Report field data when Google has enough real-user data).", { color: C.muted });
  if (!r.performance.length) p("Performance was not tested for this audit.", { color: C.muted });
  for (const perf of r.performance) {
    h2(`${perf.strategy === "mobile" ? "Mobile" : "Desktop"}: ${perf.status === "ok" ? `${perf.score}/100` : "Not tested"}${perf.fetchedAt ? ` · collected ${when(perf.fetchedAt)}` : ""}`);
    if (perf.status !== "ok") {
      p(perf.error || "Not tested.", { color: C.muted });
      continue;
    }
    if (perf.categories) {
      table([{ header: "Lighthouse category", width: 50 }, { header: "Score", width: 50 }], [["Performance", fmtScore(perf.categories.performance)], ["Accessibility", fmtScore(perf.categories.accessibility)], ["Best Practices", fmtScore(perf.categories.bestPractices)], ["SEO", fmtScore(perf.categories.seo)]]);
    }
    table([{ header: "Lab metric (Lighthouse)", width: 50 }, { header: "Value", width: 50 }], Object.entries(perf.lab).map(([k, v]) => [k, v.display ?? "Unavailable"]));
    if (perf.field.source === "none") p("Field data: No field data available. INP is reported only from field data and is not estimated.", { color: C.muted });
    else table([{ header: `Field metric (CrUX, ${perf.field.source}-level, p75)`, width: 50 }, { header: "Value / rating", width: 50 }], Object.entries(perf.field.metrics).map(([k, m]) => [k, `${m.p75 ?? "n/a"}${k === "CLS" ? "" : " ms"} (${m.category ?? "n/a"})`]));
    if (perf.opportunities.length) table([{ header: "Opportunity", width: 70 }, { header: "Estimated saving", width: 30 }], perf.opportunities.map((o) => [o.title, o.display ?? "—"]));
  }
  h2("Mobile usability");
  checkTable(byGroup("mobile"));
  if (r.render.viewports.length) {
    table(
      [{ header: "Viewport", width: 20 }, { header: "Horizontal overflow", width: 20 }, { header: "Small text", width: 20 }, { header: "Small tap targets", width: 20 }, { header: "Wide images", width: 20 }],
      r.render.viewports.map((v) => [`${v.name} ${v.width}px`, v.horizontalOverflow ? `Yes (${v.scrollWidth}px)` : "No", `${Math.round(v.smallTextRatio * 100)}%`, `${v.smallTapTargets}/${v.tapTargetsChecked}`, String(v.imagesWiderThanViewport)]),
    );
  }

  // 17. Detailed issue evidence
  h1("Detailed issue evidence");
  const issues = prioritizedIssues(r.checks);
  if (!issues.length) p("No failed or warning checks.", { color: C.muted });
  for (const c of issues.slice(0, 80)) {
    const state = r.issueStates?.[c.id];
    h2(`${c.title} (${STATUS_LABEL[c.status]}, ${c.severity})`);
    p(`${CATEGORY_LABELS[c.category]} · Source: ${SOURCE_LABELS[sourceOf(c)]}${c.detectedAt ? ` · Detected ${when(c.detectedAt)}` : ""}${state ? ` · Marked ${state.replace("_", " ")}` : ""}`, { color: C.muted, size: 8.5 });
    p(`Why it matters: ${c.explanation}`);
    if (c.evidence.length) p(`Evidence: ${c.evidence.slice(0, 6).join(" | ")}`, { size: 8.5 });
    const urls = c.affectedUrls?.length ? c.affectedUrls : [c.url];
    p(`Affected URL(s) (${urls.length}): ${urls.slice(0, 8).map(wrapUrl).join(", ")}${urls.length > 8 ? ` and ${urls.length - 8} more` : ""}`, { size: 8.5 });
    p(`Detection: ${c.detection}${c.limitation ? ` Limitation: ${c.limitation}` : ""}`, { color: C.muted, size: 8.5 });
  }
  if (issues.length > 80) p(`…and ${issues.length - 80} more issues (see CSV export).`, { color: C.muted });

  // 18. Recommended fixes
  h1("Recommended fixes in priority order");
  table(
    [{ header: "#", width: 5 }, { header: "Issue", width: 25 }, { header: "Severity", width: 10 }, { header: "Pages", width: 8 }, { header: "Recommended fix", width: 52 }],
    issues.map((c, i) => [String(i + 1), c.title, c.severity, String(c.affectedUrls?.length || 1), c.recommendation]),
  );

  // 19. Methodology
  h1("Methodology");
  p(r.scores.overall.formula);
  p(`Each check is worth points by severity (critical ${SEVERITY_WEIGHTS.critical}, high ${SEVERITY_WEIGHTS.high}, medium ${SEVERITY_WEIGHTS.medium}, low ${SEVERITY_WEIGHTS.low}). A pass earns ${STATUS_CREDIT.pass * 100}%, a warning ${STATUS_CREDIT.warning * 100}% and a failure ${STATUS_CREDIT.fail * 100}%. Not applicable, informational and skipped checks are excluded from the denominator, so missing data never counts as a pass or a failure. Each check belongs to exactly one category, so no issue is scored twice. Performance uses the Lighthouse performance score directly.`);
  p(`SEO score weights: ${Object.entries(SEO_COMPONENT_WEIGHTS).map(([k, v]) => `${CATEGORY_LABELS[k as Category]} ${v}%`).join(", ")}. Overall health weights: ${Object.entries(OVERALL_WEIGHTS).map(([k, v]) => `${k} ${v}%`).join(", ")}. Weights are renormalised over the parts that were tested.`);
  p("Length, count and structure guidance is diagnostic. It is not a statement about Google ranking penalties.", { color: C.muted });

  // 20. Data sources and limitations
  h1("Data sources and limitations");
  p("Every finding is labelled with its source: Observed (measured directly from fetched pages, headers or robots/sitemap files), External (returned by a Google API) or Assessment (this tool's judgement from page signals).");
  table([{ header: "Source", width: 40 }, { header: "Findings", width: 60 }], (Object.keys(SOURCE_LABELS) as (keyof typeof SOURCE_LABELS)[]).map((k) => [SOURCE_LABELS[k], String(r.checks.filter((c) => sourceOf(c) === k).length)]));
  if (r.warnings?.length) {
    h2("Warnings");
    r.warnings.forEach((w) => p(`• ${w}`));
  }
  if (r.partialReasons.length) {
    h2("Why this report is partial");
    r.partialReasons.forEach((w) => p(`• ${w}`));
  }
  h2("Limitations");
  r.limitations.forEach((l) => p(`• ${l}`));
  table([{ header: "Integration", width: 40 }, { header: "Status", width: 60 }], [
    ["PageSpeed Insights", r.integrations.pagespeed], ["Google Search Console", r.integrations.searchConsole], ["Browser rendering", r.integrations.rendering], ["AI provider", r.integrations.ai], ["Keyword data provider", r.integrations.keywordData],
    ...(r.integrations.aiVisibility ? [["AI visibility data", r.integrations.aiVisibility]] : []),
  ]);
  if (r.tasks?.length) {
    h2("External tasks");
    table([{ header: "Task", width: 40 }, { header: "Status", width: 15 }, { header: "Detail", width: 45 }], r.tasks.map((x) => [x.label, x.status, x.detail || "—"]));
  }

  // Footer with page numbers on every page.
  const range = doc.bufferedPageRange();
  const generated = new Date().toISOString().slice(0, 10);
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 40;
    const m = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("R").fontSize(7.5).fillColor(C.muted);
    doc.text(`${APP_NAME} · ${r.finalUrl.length > 70 ? r.finalUrl.slice(0, 69) + "…" : r.finalUrl} · Generated ${generated}${r.status === "partial" ? " · PARTIALLY COMPLETED" : ""}`, L, y, { width: W - 60, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, L + W - 60, y, { width: 60, align: "right", lineBreak: false });
    doc.page.margins.bottom = m;
  }
  doc.end();
  return done;
}
