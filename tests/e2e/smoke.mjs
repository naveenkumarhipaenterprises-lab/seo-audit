// End-to-end smoke test against a running server: drives the real UI, runs a real
// audit, verifies progress events, report content, PDF and CSV downloads, and checks
// for horizontal overflow at mobile and desktop widths.
// Usage: BASE_URL=http://localhost:3000 AUDIT_URL=https://example.com node tests/e2e/smoke.mjs
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const TARGET = process.env.AUDIT_URL || "https://example.com/";
const OUT = process.env.SCREENSHOT_DIR || "tests/e2e/screenshots";
mkdirSync(OUT, { recursive: true });
const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ok - ${msg}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(BASE + "/audit/new");
  await page.fill("#url", TARGET);
  await page.fill("#kw", process.env.AUDIT_KEYWORD || "");
  const full = process.env.MODE === "full";
  if (full) {
    await page.check("input[name=mode][value=full]");
    await page.fill("#maxPages", process.env.MAX_PAGES || "6");
  }
  if (process.env.NO_PSI === "1") await page.click("#perf");
  page.on("console", (m) => m.type() === "error" && console.log("  console error:", m.text()));
  await page.click("button[type=submit]");
  await page.waitForSelector("[role=progressbar]");
  const progressSamples = [];
  const sample = async () => {
    const v = await page.getAttribute("[role=progressbar]", "aria-valuenow").catch(() => null);
    if (v !== null) progressSamples.push(Number(v));
  };
  for (let i = 0; i < 6; i++) {
    await sample();
    if (i === 3) await page.screenshot({ path: `${OUT}/progress.png` });
    await page.waitForTimeout(400);
  }
  const dialogText = await page.textContent("[role=dialog]");
  assert(/Estimated time unavailable|elapsed/.test(dialogText), "dialog shows elapsed time and no invented countdown");

  // Progress survives navigation and a full page reload.
  await page.click("text=Continue in background");
  await page.goto(BASE + "/history");
  await page.waitForSelector("[data-testid=progress-dock]", { timeout: 10000 });
  assert(true, "progress dock is restored after reloading another page");
  await page.screenshot({ path: `${OUT}/progress-dock.png` });
  await page.click("[aria-label='Show audit progress']").catch(() => undefined);

  for (let i = 0; i < 1200 && !page.url().includes("/audits/"); i++) {
    await sample();
    const open = await page.$("[data-testid=progress-dock] a:has-text('Open')");
    if (open) await open.click();
    const failed = await page.$("text=Audit failed");
    if (failed) throw new Error("audit failed: " + (await page.textContent("[role=dialog]").catch(() => "")));
    await page.waitForTimeout(250);
  }
  assert(page.url().includes("/audits/"), "audit completed and report opened");
  assert(progressSamples.some((v) => v > 0 && v < 100), `progress showed intermediate stage completion (${[...new Set(progressSamples)].join(",")})`);
  assert(progressSamples.every((v, i) => i === 0 || v >= progressSamples[i - 1]), "progress never went backwards");
  await page.waitForSelector("text=Overall Health");
  await page.screenshot({ path: `${OUT}/report-desktop.png`, fullPage: true });
  const body = await page.textContent("body");
  assert(body.includes(new URL(TARGET).hostname), "report shows the audited site");
  assert(body.includes("Not verified through Search Console"), "indexing status is honestly unverified");
  assert(body.includes(full ? "Full Site Audit" : "Quick Audit"), "report header shows the audit mode");
  assert(await page.isVisible("[data-testid=new-audit]"), "New Audit button is present");

  const [pdf] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=download-pdf]")]);
  const pdfPath = `${OUT}/report.pdf`;
  await pdf.saveAs(pdfPath);
  const [csv] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=export-csv]")]);
  const csvPath = `${OUT}/report.csv`;
  await csv.saveAs(csvPath);
  const { readFileSync } = await import("node:fs");
  assert(readFileSync(pdfPath).subarray(0, 5).toString() === "%PDF-", `PDF downloaded (${pdf.suggestedFilename()})`);
  const csvText = readFileSync(csvPath, "utf8");
  assert(csvText.includes("Check,") && csvText.includes("title-present"), `CSV downloaded with check rows (${csv.suggestedFilename()})`);

  for (const tab of ["Technical SEO", "Images", "Keywords & Content", "AEO", "GEO", "Performance & Mobile", ...(full ? ["Pages"] : []), "Methodology"]) {
    await page.click(`role=tab[name="${tab}"]`);
    await page.waitForTimeout(150);
  }
  await page.click('role=tab[name="Images"]');
  await page.screenshot({ path: `${OUT}/images-desktop.png`, fullPage: true });
  const reportUrl = page.url().split("?")[0];
  if (full) {
    await page.click('role=tab[name="Pages"]');
    const sel = "[role=tabpanel] table:has(caption:has-text('Pages analysed')) tbody tr";
    await page.waitForSelector(sel);
    const rows = await page.$$(sel);
    assert(rows.length > 1, `page inventory lists ${rows.length} crawled pages`);
    await page.screenshot({ path: `${OUT}/pages-desktop.png`, fullPage: true });
  }

  // Cancellation: start another audit and cancel it.
  await page.goto(BASE + "/audit/new");
  await page.fill("#url", TARGET);
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Cancel audit");
  await page.click("text=Cancel audit");
  await page.waitForSelector("text=Audit cancelled", { timeout: 30000 });
  assert(true, "a running audit can be cancelled");
  await page.screenshot({ path: `${OUT}/cancelled.png` });

  // Another browser (no owner cookie) cannot open this report.
  const stranger = await browser.newContext();
  const sp = await stranger.newPage();
  const res = await sp.goto(reportUrl);
  assert(res.status() === 404, `a different browser gets 404 for this report (HTTP ${res.status()})`);
  const pdfRes = await sp.request.get(reportUrl.replace("/audits/", "/api/audits/") + "/pdf");
  assert(pdfRes.status() === 404, `a different browser cannot download its PDF (HTTP ${pdfRes.status()})`);
  await stranger.close();
  const state = await ctx.storageState();

  for (const [name, width, height] of [["mobile", 375, 812], ["tablet", 768, 1024], ["desktop", 1366, 900]]) {
    const c = await browser.newContext({ viewport: { width, height }, isMobile: width < 800, hasTouch: width < 800, storageState: state });
    const p = await c.newPage();
    for (const path of ["/", reportUrl.replace(BASE, ""), "/history", "/settings", "/reports"]) {
      await p.goto(BASE + path);
      await p.waitForLoadState("networkidle");
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      assert(sw <= width + 1, `${name} ${width}px: no horizontal overflow on ${path} (scrollWidth ${sw})`);
    }
    if (width < 1024) {
      await p.goto(BASE + "/");
      assert(await p.isVisible("[data-testid=open-nav]"), `${name}: menu button visible`);
      await p.click("[data-testid=open-nav]");
      assert(await p.isVisible("role=dialog[name=Navigation]"), `${name}: navigation drawer opens`);
      await p.screenshot({ path: `${OUT}/nav-${name}.png` });
      await p.goto(BASE + reportUrl.replace(BASE, ""));
      await p.screenshot({ path: `${OUT}/report-${name}.png`, fullPage: true });
    } else {
      assert(!(await p.isVisible("[data-testid=open-nav]")), "desktop: sidebar shown, no menu button");
    }
    await c.close();
  }
  writeFileSync(`${OUT}/RESULT.txt`, `PASS ${new Date().toISOString()} ${TARGET} -> ${reportUrl}\n`);
  console.log("E2E PASS");
} finally {
  await browser.close();
}
