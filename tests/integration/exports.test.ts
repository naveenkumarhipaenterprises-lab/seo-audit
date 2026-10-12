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
    expect(flat).toContain("Website Visibility Audit");
    expect(flat).toContain("PARTIAL REPORT");
    expect(flat).toContain("Organic Spice Blends for Home Cooks");
    expect(flat).toContain("Google indexing status not verified");
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
    expect((await store.list()).map((s) => s.id)).toEqual([rec.id]);
    expect((await store.get(rec.id))?.finalUrl).toBe(rec.finalUrl);
    expect(await store.get("../../etc/passwd")).toBeNull();
    expect(await store.remove(rec.id)).toBe(true);
    expect(await store.list()).toEqual([]);
  });
});
