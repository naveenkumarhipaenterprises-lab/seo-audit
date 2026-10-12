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
  await page.goto(BASE);
  await page.fill("#url", TARGET);
  await page.fill("#kw", process.env.AUDIT_KEYWORD || "");
  const seen = new Set();
  page.on("console", (m) => m.type() === "error" && console.log("  console error:", m.text()));
  await page.click("button[type=submit]");
  await page.waitForSelector("[role=progressbar]");
  let sawPartial = false;
  const progressSamples = [];
  for (let i = 0; i < 240 && !page.url().includes("/audits/"); i++) {
    const v = await page.getAttribute("[role=progressbar]", "aria-valuenow").catch(() => null);
    if (v !== null) {
      progressSamples.push(Number(v));
      if (Number(v) > 0 && Number(v) < 100) sawPartial = true;
      seen.add(v);
      if (i === 3) await page.screenshot({ path: `${OUT}/progress.png` });
    }
    await page.waitForTimeout(250);
  }
  assert(page.url().includes("/audits/"), "audit completed and report opened");
  assert(sawPartial, `preloader showed intermediate progress (${[...seen].join(",")})`);
  assert(progressSamples.every((v, i) => i === 0 || v >= progressSamples[i - 1]), "progress never went backwards");
  await page.waitForSelector("text=Overall Visibility");
  await page.screenshot({ path: `${OUT}/report-desktop.png`, fullPage: true });
  const body = await page.textContent("body");
  assert(body.includes(new URL(TARGET).hostname), "report shows the audited site");
  assert(body.includes("Google indexing status not verified"), "indexing status is honestly unverified");

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

  for (const tab of ["Technical SEO", "Images", "AEO", "GEO", "Performance & Mobile", "Methodology"]) {
    await page.click(`role=tab[name="${tab}"]`);
    await page.waitForTimeout(150);
  }
  await page.click('role=tab[name="Images"]');
  await page.screenshot({ path: `${OUT}/images-desktop.png`, fullPage: true });
  const reportUrl = page.url().split("?")[0];

  for (const [name, width, height] of [["mobile", 375, 812], ["tablet", 768, 1024], ["desktop", 1366, 900]]) {
    const c = await browser.newContext({ viewport: { width, height }, isMobile: width < 800, hasTouch: width < 800 });
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
