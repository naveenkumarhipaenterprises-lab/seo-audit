import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AuditFinalStatus, AuditMode, AuditRecord } from "../audit/types";
import { normalizeRecord } from "../audit/record-utils";
import { canAccess } from "../security/owner";

export interface AuditSummary {
  id: string;
  createdAt: string;
  /** "complete" only on MVP-era summaries. */
  status: AuditFinalStatus | "complete";
  mode?: AuditMode;
  pagesAnalyzed?: number;
  ownerId?: string;
  /** Present for failed or cancelled audits, which have no full report. */
  failure?: { stage?: string; message: string };
  hasReport?: boolean;
  url: string;
  finalUrl: string;
  overall: number | null;
  seo: number | null;
  aeo: number | null;
  geo: number | null;
  performance: number | null;
  errors: number;
  warnings: number;
}

/**
 * Storage adapter. Ships a file-system store; a Supabase adapter implementing the same
 * interface can replace it (schema in supabase/migrations).
 */
export interface AuditStore {
  save(record: AuditRecord): Promise<void>;
  /** Records a failed or cancelled audit (summary only, no report). */
  saveOutcome(summary: AuditSummary): Promise<void>;
  /** Returns the record only when `owner` may access it (see lib/security/owner). */
  get(id: string, owner: string | null): Promise<AuditRecord | null>;
  list(owner: string | null, limit?: number): Promise<AuditSummary[]>;
  remove(id: string, owner: string | null): Promise<boolean>;
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isValidAuditId = (id: string) => ID_RE.test(id);

export function summarize(r: AuditRecord): AuditSummary {
  return {
    id: r.id,
    createdAt: r.createdAt,
    status: r.status,
    mode: r.input.mode || "quick",
    pagesAnalyzed: r.pagesCrawled,
    ownerId: r.ownerId,
    hasReport: true,
    url: r.requestedUrl,
    finalUrl: r.finalUrl,
    overall: r.scores.overall.score,
    seo: r.scores.seo.score,
    aeo: r.scores.categories.aeo.score,
    geo: r.scores.categories.geo.score,
    performance: r.scores.categories.performance.score,
    errors: r.scores.totals.errors,
    warnings: r.scores.totals.warnings,
  };
}

class FileStore implements AuditStore {
  constructor(private dir: string, private retentionDays: number) {}
  private file(id: string, kind: "json" | "meta.json") {
    if (!isValidAuditId(id)) throw new Error("Invalid audit id");
    return path.join(/* turbopackIgnore: true */ this.dir, `${id}.${kind}`);
  }
  async save(record: AuditRecord) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.file(record.id, "json"), JSON.stringify(record), { mode: 0o600 });
    await fs.writeFile(this.file(record.id, "meta.json"), JSON.stringify(summarize(record)), { mode: 0o600 });
  }
  async saveOutcome(summary: AuditSummary) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.file(summary.id, "meta.json"), JSON.stringify({ ...summary, hasReport: false }), { mode: 0o600 });
  }
  async get(id: string, owner: string | null) {
    if (!isValidAuditId(id)) return null;
    try {
      const r = JSON.parse(await fs.readFile(this.file(id, "json"), "utf8")) as AuditRecord;
      return canAccess(r.ownerId, owner) ? normalizeRecord(r) : null;
    } catch {
      return null;
    }
  }
  async list(owner: string | null, limit = 50) {
    let names: string[];
    try {
      names = (await fs.readdir(this.dir)).filter((n) => n.endsWith(".meta.json"));
    } catch {
      return [];
    }
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    const items: AuditSummary[] = [];
    for (const n of names) {
      try {
        const s = JSON.parse(await fs.readFile(path.join(/* turbopackIgnore: true */ this.dir, n), "utf8")) as AuditSummary;
        if (this.retentionDays > 0 && Date.parse(s.createdAt) < cutoff) {
          await this.purge(s.id);
          continue;
        }
        if (canAccess(s.ownerId, owner)) items.push(s);
      } catch {}
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async remove(id: string, owner: string | null) {
    if (!isValidAuditId(id)) return false;
    try {
      const s = JSON.parse(await fs.readFile(this.file(id, "meta.json"), "utf8")) as AuditSummary;
      if (!canAccess(s.ownerId, owner)) return false;
    } catch {
      return false;
    }
    return this.purge(id);
  }
  private async purge(id: string) {
    let removed = false;
    for (const kind of ["json", "meta.json"] as const) {
      try {
        await fs.unlink(this.file(id, kind));
        removed = true;
      } catch {}
    }
    return removed;
  }
}

let store: AuditStore | null = null;
export function getStore(): AuditStore {
  if (!store) {
    const dir = process.env.AUDIT_DATA_DIR || (process.env.VERCEL ? "/tmp/searchscope-audits" : path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "audits"));
    store = new FileStore(dir, Number(process.env.AUDIT_RETENTION_DAYS ?? 30));
  }
  return store;
}

export function createFileStore(dir: string, retentionDays = 30): AuditStore {
  return new FileStore(dir, retentionDays);
}
