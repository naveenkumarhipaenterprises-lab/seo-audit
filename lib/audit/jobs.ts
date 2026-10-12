import "server-only";
import { randomUUID } from "node:crypto";
import { runAudit, AuditAbortedError, AuditFailedError, type AuditDeps } from "./run";
import { stagesForMode, type AuditFinalStatus, type AuditInput, type CrawlProgress, type StageId, type StageState, type TaskState } from "./types";
import { LIMITS } from "../config";
import type { AuditStore } from "../store";
import { canAccess } from "../security/owner";
import { log } from "../log";

/**
 * In-process audit job registry. Audits run in the background of the Node server so
 * progress survives page navigation and refreshes; clients poll the job by id.
 * Single-process only: on a multi-instance or serverless host, jobs must be moved to a
 * queue/worker (see README "Deployment").
 */
export interface Job {
  id: string;
  ownerId: string | null;
  url: string;
  mode: AuditInput["mode"];
  startedAt: number;
  finishedAt?: number;
  status: "running" | AuditFinalStatus;
  stages: StageState[];
  tasks: TaskState[];
  pages?: CrawlProgress;
  error?: { message: string; stage?: StageId };
  auditId?: string;
  controller: AbortController;
}

export interface JobView {
  id: string;
  url: string;
  mode: AuditInput["mode"];
  status: Job["status"];
  startedAt: string;
  elapsedMs: number;
  stages: StageState[];
  tasks: TaskState[];
  pages: CrawlProgress | null;
  /** Share of stages finished; derived from real stage completions only. */
  percent: number;
  currentStage: StageState | null;
  error: Job["error"] | null;
  auditId: string | null;
}

const g = globalThis as unknown as { __ssJobs?: Map<string, Job> };
const jobs: Map<string, Job> = (g.__ssJobs ??= new Map());

function purge(now = Date.now()) {
  for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > LIMITS.jobRetentionMs) jobs.delete(id);
}

export function view(j: Job, now = Date.now()): JobView {
  const finished = j.stages.filter((s) => s.status === "completed" || s.status === "skipped" || s.status === "failed").length;
  return {
    id: j.id,
    url: j.url,
    mode: j.mode,
    status: j.status,
    startedAt: new Date(j.startedAt).toISOString(),
    elapsedMs: (j.finishedAt ?? now) - j.startedAt,
    stages: j.stages.map((s) => ({ ...s })),
    tasks: j.tasks.map((t) => ({ ...t })),
    pages: j.pages ? { ...j.pages } : null,
    percent: j.status === "completed" || j.status === "completed_with_warnings" || j.status === "partial" ? 100 : Math.round((finished / j.stages.length) * 100),
    currentStage: j.stages.find((s) => s.status === "running") || null,
    error: j.error || null,
    auditId: j.auditId || null,
  };
}

export function getJob(id: string, owner: string | null): Job | null {
  purge();
  const j = jobs.get(id);
  return j && canAccess(j.ownerId, owner) ? j : null;
}

export function activeJobs(owner: string | null): Job[] {
  purge();
  return Array.from(jobs.values()).filter((j) => canAccess(j.ownerId, owner) && (j.status === "running" || (j.finishedAt && Date.now() - j.finishedAt < 5 * 60_000)));
}

/** Returns a running job for the same owner, URL and mode, so a double submit or refresh does not start a second audit. */
export function findDuplicate(owner: string | null, input: AuditInput): Job | null {
  for (const j of jobs.values()) if (j.status === "running" && j.ownerId === owner && j.url === input.url.trim() && j.mode === input.mode) return j;
  return null;
}

export function cancelJob(id: string, owner: string | null): boolean {
  const j = getJob(id, owner);
  if (!j || j.status !== "running") return false;
  j.controller.abort();
  return true;
}

export function startJob(input: AuditInput, owner: string | null, deps: AuditDeps, store: Pick<AuditStore, "saveOutcome">, release: () => void): Job {
  purge();
  const id = randomUUID();
  const job: Job = {
    id,
    ownerId: owner,
    url: input.url.trim(),
    mode: input.mode,
    startedAt: Date.now(),
    status: "running",
    stages: stagesForMode(input.mode).map((s) => ({ id: s.id, label: s.label, status: "queued" })),
    tasks: [],
    controller: new AbortController(),
  };
  jobs.set(id, job);
  const fail = async (status: "failed" | "cancelled", message: string, stage?: StageId) => {
    job.status = status;
    job.error = { message, stage };
    // Any stage still running at this point did not finish.
    for (const s of job.stages) if (s.status === "running") Object.assign(s, { status: status === "cancelled" ? "skipped" : "failed", detail: status === "cancelled" ? "Cancelled" : message });
    for (const t of job.tasks) if (t.status === "running") t.status = "skipped";
    try {
      await store.saveOutcome({
        id, createdAt: new Date(job.startedAt).toISOString(), status, mode: job.mode, ownerId: owner || undefined, failure: { stage, message },
        url: job.url, finalUrl: job.url, overall: null, seo: null, aeo: null, geo: null, performance: null, errors: 0, warnings: 0, pagesAnalyzed: job.pages?.processed ?? 0,
      });
    } catch (e) {
      log("warn", "job.outcome_save_failed", { id, error: (e as Error).message });
    }
  };
  log("info", "audit.start", { id, mode: input.mode, host: safeHost(input.url) });
  void runAudit(input, deps, (e) => {
    if (e.type === "stage") {
      const s = job.stages.find((x) => x.id === e.stage);
      if (s) {
        s.status = e.status;
        s.detail = e.detail;
      }
    } else if (e.type === "task") {
      const i = job.tasks.findIndex((t) => t.id === e.task.id);
      if (i >= 0) job.tasks[i] = e.task;
      else job.tasks.push(e.task);
    } else if (e.type === "pages") job.pages = e.pages;
    else if (e.type === "done") {
      job.auditId = e.auditId;
      job.status = e.status;
    }
  }, job.controller.signal, { id, ownerId: owner })
    .catch(async (e) => {
      if (e instanceof AuditAbortedError || job.controller.signal.aborted) await fail("cancelled", "The audit was cancelled.", (e as AuditAbortedError).stage);
      else if (e instanceof AuditFailedError) await fail("failed", e.message, e.stage);
      else {
        log("error", "audit.unexpected", { id, name: (e as Error)?.name, message: (e as Error)?.message });
        await fail("failed", "The audit failed unexpectedly. Please try again.", job.stages.find((s) => s.status === "running")?.id);
      }
    })
    .finally(() => {
      job.finishedAt = Date.now();
      release();
      log("info", "audit.end", { id, status: job.status, ms: job.finishedAt - job.startedAt });
    });
  return job;
}

function safeHost(u: string) {
  try {
    return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname;
  } catch {
    return "invalid";
  }
}

/** Test helper. */
export function _resetJobsForTests() {
  jobs.clear();
}
