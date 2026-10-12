import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { runAudit } from "@/lib/audit/run";
import { auditToPdf } from "@/lib/export/pdf";
import { auditToCsv, csvField } from "@/lib/export/csv";
import { createFileStore } from "@/lib/store";
import { baseInput, fixture, fixtureFetcher, testDeps } from "../helpers";

async function sampleRecord() {
  const deps = testDeps(fixtureFetcher({ "https://www.example-healthy.com/spice-blends": { body: fixture("healthy.html") } }));
  return runAudit(baseInput("https://www.example-healthy.com/spice-blends", { primaryKeyword: "spice blends" }), deps, () => {});
}

describe("PDF report", () => {
  it("generates a multi-page PDF containing the actual findings", async () => {
    const rec = await sampleRecord();
    const pdf = await auditToPdf(rec);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const parser = new PDFParse({ data: new Uint8Array(pdf) });
    const { text, total } = await parser.getText();
    await parser.destroy();
    const flat = text.replace(/​/g, "");
    expect(total).toBeGreaterThan(5);
    expect(flat).toContain("Quick Audit Report");
    expect(flat).toContain("PARTIALLY COMPLETED REPORT");
    for (const section of ["Audit configuration", "Executive overview", "Overall and category scores", "Pages analysed", "Passed and failed checks", "Critical and high-priority issues", "Technical SEO results", "Metadata and indexability findings", "Image audit", "Content and on-page keyword findings", "AEO readiness assessment", "GEO readiness assessment", "Performance results and source", "Detailed issue evidence", "Methodology", "Data sources and limitations"]) {
      expect(flat).toContain(section);
    }
    expect(flat).toContain("Organic Spice Blends for Home Cooks");
    expect(flat).toContain("Not verified through Search Console");
    expect(flat).toContain("Recommended fixes in priority order");
    expect(flat).toContain(`Page 1 of ${total}`);
    expect(flat).toContain(String(rec.scores.overall.score));
  });
});

describe("CSV export", () => {
  it("contains one row per check plus images, quoted safely", async () => {
    const rec = await sampleRecord();
    const csv = auditToCsv(rec);
    const lines = csv.split("\r\n");
    expect(lines[0]).toMatch(/^﻿Section,Category/);
    expect(lines.filter((l) => l.startsWith("Check,"))).toHaveLength(rec.checks.length);
    expect(lines.filter((l) => l.startsWith("Image,"))).toHaveLength(rec.images.length);
    expect(csv).toContain("https://www.example-healthy.com/img/blend.webp");
    expect(lines[0]).toContain("Source");
    expect(lines[0]).toContain("Issue status");
    expect(csv).toContain("Audit,Mode,Quick Audit");
  });
  it("neutralises formula injection and escapes quotes", () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField(null)).toBe("");
  });
});

describe("file store", () => {
  it("saves, lists, reads and deletes; rejects path traversal ids", async () => {
    const store = createFileStore(mkdtempSync(path.join(os.tmpdir(), "ss-")));
    const rec = await sampleRecord();
    await store.save(rec);
    expect((await store.list(null)).map((s) => s.id)).toEqual([rec.id]);
    expect((await store.get(rec.id, null))?.finalUrl).toBe(rec.finalUrl);
    expect(await store.get("../../etc/passwd", null)).toBeNull();
    expect(await store.remove(rec.id, null)).toBe(true);
    expect(await store.list(null)).toEqual([]);
  });

  it("scopes records to their owner", async () => {
    const store = createFileStore(mkdtempSync(path.join(os.tmpdir(), "ss-")));
    const rec = { ...(await sampleRecord()), ownerId: "a".repeat(32) };
    await store.save(rec);
    expect(await store.get(rec.id, "b".repeat(32))).toBeNull();
    expect(await store.get(rec.id, null)).toBeNull();
    expect(await store.list("b".repeat(32))).toEqual([]);
    expect(await store.remove(rec.id, "b".repeat(32))).toBe(false);
    expect((await store.get(rec.id, "a".repeat(32)))?.id).toBe(rec.id);
    expect((await store.list("a".repeat(32))).map((s) => s.id)).toEqual([rec.id]);
    expect(await store.remove(rec.id, "a".repeat(32))).toBe(true);
  });

  it("records failed audits as summaries without a report", async () => {
    const store = createFileStore(mkdtempSync(path.join(os.tmpdir(), "ss-")));
    const id = "11111111-1111-4111-8111-111111111111";
    await store.saveOutcome({ id, createdAt: new Date().toISOString(), status: "failed", failure: { stage: "fetch", message: "boom" }, url: "https://x.test/", finalUrl: "https://x.test/", overall: null, seo: null, aeo: null, geo: null, performance: null, errors: 0, warnings: 0 });
    const [s] = await store.list(null);
    expect(s).toMatchObject({ id, status: "failed", hasReport: false });
    expect(await store.get(id, null)).toBeNull();
  });
});
