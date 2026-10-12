"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronUp, CircleDashed, ExternalLink, Loader2, Minimize2, MinusCircle, RotateCcw, XCircle } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cancelAuditJob, getJobView, listActiveJobs, startAuditJob, type JobView } from "@/lib/client/jobs";
import { normalizeStageStatus, statusLabel } from "@/lib/audit/record-utils";
import type { StageStatus } from "@/lib/audit/types";
import { cn, hostOf } from "@/lib/utils";

interface JobsCtx {
  job: JobView | null;
  error: string | null;
  starting: boolean;
  start: (body: Record<string, unknown>) => Promise<boolean>;
  cancel: () => Promise<void>;
}
const Ctx = createContext<JobsCtx | null>(null);
export const useAuditJobs = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuditJobs must be used inside AuditJobsProvider");
  return c;
};

const STORAGE_KEY = "searchscope.activeJob";
const POLL_MS = 1000;
const FINAL = (s: JobView["status"]) => s !== "running";
const store = {
  get: () => {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set: (v: string | null) => {
    try {
      if (v) window.localStorage.setItem(STORAGE_KEY, v);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  },
};

export function fmtElapsed(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Holds the browser's active audit job and polls its real server-side status. Mounted in the
 * app shell, so progress stays visible while the user moves between dashboard sections and
 * resumes after a page refresh (the job runs on the server, not in this tab).
 */
export function AuditJobsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lastBody, setLastBody] = useState<Record<string, unknown> | null>(null);
  const [polledAt, setPolledAt] = useState(0);
  const [tick, setTick] = useState(0);
  const failures = useRef(0);
  const navigated = useRef<string | null>(null);

  // Resume a job that is still running (or just finished) after a refresh or in a new tab.
  useEffect(() => {
    let cancelled = false;
    listActiveJobs()
      .then((jobs) => {
        if (cancelled || !jobs.length) return;
        const remembered = store.get();
        const pick = jobs.find((j) => j.id === remembered) || jobs.find((j) => j.status === "running");
        if (pick && (pick.status === "running" || pick.id === remembered)) {
          setJob(pick);
          setPolledAt(Date.now());
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll the server while the job runs. Progress only changes when the server reports it.
  useEffect(() => {
    if (!job || FINAL(job.status)) return;
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const v = await getJobView(job.id, ac.signal);
        failures.current = 0;
        setError(null);
        setJob(v);
        setPolledAt(Date.now());
      } catch (e) {
        if (ac.signal.aborted) return;
        if ((e as { status?: number }).status === 404) {
          setError("This audit is no longer running on the server (it may have been restarted). Start the audit again.");
          setJob((j) => (j ? { ...j, status: "failed", error: { message: "Audit job lost on the server." } } : j));
          store.set(null);
          return;
        }
        failures.current++;
        setError(failures.current >= 5 ? "Lost connection to the server. Progress will resume when the connection returns." : null);
        setTick((n) => n + 1);
      }
    }, POLL_MS);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [job, tick]);

  // Local clock for the elapsed-time display only (never drives progress).
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!job || FINAL(job.status)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job]);

  useEffect(() => {
    if (!job || !FINAL(job.status)) return;
    store.set(null);
    if (job.auditId && expanded && navigated.current !== job.id) {
      navigated.current = job.id;
      router.push(`/audits/${job.auditId}`);
      router.refresh();
      setExpanded(false);
    } else if (job.auditId) router.refresh();
  }, [job, expanded, router]);

  const start = useCallback(async (body: Record<string, unknown>) => {
    setStarting(true);
    setError(null);
    try {
      const r = await startAuditJob(body);
      setLastBody(body);
      setJob(r.job);
      setPolledAt(Date.now());
      setExpanded(true);
      store.set(r.jobId);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setStarting(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    if (!job) return;
    try {
      setJob(await cancelAuditJob(job.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [job]);

  const dismiss = () => {
    setJob(null);
    setError(null);
    setExpanded(false);
    store.set(null);
  };

  const elapsed = job ? job.elapsedMs + (FINAL(job.status) ? 0 : (now > polledAt ? now - polledAt : 0)) : 0;

  return (
    <Ctx.Provider value={{ job, error, starting, start, cancel }}>
      {children}
      {job && expanded && (
        <ProgressDialog job={job} error={error} elapsed={elapsed} onMinimize={() => setExpanded(false)} onCancel={cancel} onClose={dismiss}
          onRetry={lastBody ? () => start(lastBody) : undefined} />
      )}
      {job && !expanded && <ProgressDock job={job} elapsed={elapsed} onExpand={() => setExpanded(true)} onClose={dismiss} />}
    </Ctx.Provider>
  );
}

function StageIcon({ status }: { status: StageStatus | string }) {
  const s = normalizeStageStatus(status);
  const c = "mt-0.5 h-4 w-4 shrink-0";
  if (s === "completed") return <CheckCircle2 className={cn(c, "text-green-600")} aria-hidden />;
  if (s === "running") return <Loader2 className={cn(c, "motion-safe:animate-spin text-brand-600")} aria-hidden />;
  if (s === "failed") return <XCircle className={cn(c, "text-red-600")} aria-hidden />;
  if (s === "skipped") return <MinusCircle className={cn(c, "text-slate-400")} aria-hidden />;
  return <CircleDashed className={cn(c, "text-slate-300")} aria-hidden />;
}
const STAGE_WORD: Record<StageStatus, string> = { queued: "Queued", running: "Running", completed: "Completed", skipped: "Skipped", failed: "Failed" };

function headline(job: JobView) {
  if (job.status === "running") return "Auditing website";
  if (job.status === "cancelled") return "Audit cancelled";
  if (job.status === "failed") return "Audit failed";
  return statusLabel(job.status);
}

function ProgressDialog({ job, error, elapsed, onMinimize, onCancel, onClose, onRetry }: {
  job: JobView; error: string | null; elapsed: number; onMinimize: () => void; onCancel: () => void; onClose: () => void; onRetry?: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onMinimize();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onMinimize]);
  const running = job.status === "running";
  const finished = job.stages.filter((s) => ["completed", "skipped", "failed"].includes(s.status)).length;
  const p = job.pages;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="progress-title">
      <Card className="max-h-[92vh] w-full max-w-xl overflow-y-auto p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <ProgressRing pct={job.percent} running={running} failed={job.status === "failed"} />
          <div className="min-w-0 flex-1">
            <h2 id="progress-title" ref={titleRef} tabIndex={-1} className="text-lg font-semibold text-slate-900 outline-none">{headline(job)}</h2>
            <p className="truncate text-sm text-slate-500">{job.url} · {job.mode === "full" ? "Full Site Audit" : "Quick Audit"}</p>
            <p className="mt-1 text-xs text-slate-500" aria-live="polite">
              {finished} of {job.stages.length} stages finished · {fmtElapsed(elapsed)} elapsed{running ? " · Estimated time unavailable" : ""}
            </p>
          </div>
          {running && <button onClick={onMinimize} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Continue in background"><Minimize2 className="h-4 w-4" /></button>}
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={job.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Stages finished">
          <div className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", job.status === "failed" ? "bg-red-500" : job.status === "cancelled" ? "bg-slate-400" : "bg-brand-600")} style={{ width: `${job.percent}%` }} />
        </div>
        {running && job.currentStage && (
          <p className="mt-2 text-sm font-medium text-brand-700" role="status">{job.currentStage.label}{job.currentStage.detail ? ` · ${job.currentStage.detail}` : ""}</p>
        )}
        {p && (
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center" aria-label="Crawl progress">
            {([["Pages discovered", p.discovered], ["Pages processed", p.processed], ["Remaining", running ? Math.max(0, p.limit - p.processed) : 0]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 px-2 py-2"><dt className="text-[11px] text-slate-500">{k}</dt><dd className="text-base font-semibold text-slate-800">{v}</dd></div>
            ))}
          </dl>
        )}
        <ol className="mt-4 space-y-1.5" aria-label="Audit stages">
          {job.stages.map((s) => {
            const st = normalizeStageStatus(s.status);
            const tasks = job.tasks.filter((t) => t.stage === s.id);
            return (
              <li key={s.id} className="text-sm">
                <div className="flex items-start gap-2">
                  <StageIcon status={st} />
                  <span className={cn("min-w-0 flex-1", st === "queued" ? "text-slate-400" : "text-slate-700")}>
                    {s.label} <span className="sr-only">({STAGE_WORD[st]})</span>
                    {s.detail && st !== "running" && <span className="block break-words text-xs text-slate-500">{s.detail}</span>}
                  </span>
                  {(st === "skipped" || st === "failed") && <span className={cn("shrink-0 text-xs", st === "failed" ? "text-red-600" : "text-slate-400")}>{STAGE_WORD[st]}</span>}
                </div>
                {tasks.length > 0 && (
                  <ul className="mt-1 ml-6 space-y-0.5">
                    {tasks.map((t) => (
                      <li key={t.id} className="flex items-start gap-2 text-xs text-slate-600">
                        <StageIcon status={t.status} />
                        <span className="min-w-0 break-words">{t.label}{t.detail ? `: ${t.detail}` : ""} <span className="sr-only">({STAGE_WORD[normalizeStageStatus(t.status)]})</span></span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
        {(job.error || error) && (
          <div className="mt-4 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span className="break-words">{job.error?.message || error}</span>
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {running && (
            <>
              <Button variant="secondary" onClick={onMinimize}>Continue in background</Button>
              <Button variant="danger" onClick={onCancel}>Cancel audit</Button>
            </>
          )}
          {!running && (
            <>
              <Button variant="secondary" onClick={onClose}>Close</Button>
              {(job.status === "failed" || job.status === "cancelled") && onRetry && <Button onClick={onRetry}><RotateCcw className="h-4 w-4" aria-hidden /> Retry</Button>}
              {job.auditId && <a href={`/audits/${job.auditId}`} className={buttonClass("primary")}>Open report</a>}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function ProgressDock({ job, elapsed, onExpand, onClose }: { job: JobView; elapsed: number; onExpand: () => void; onClose: () => void }) {
  const running = job.status === "running";
  return (
    <div className="no-print fixed right-4 bottom-4 z-40 w-[min(22rem,calc(100vw-2rem))]" role="status" aria-live="polite" data-testid="progress-dock">
      <Card className="p-3 shadow-lg">
        <div className="flex items-center gap-3">
          {running ? <Loader2 className="h-5 w-5 shrink-0 motion-safe:animate-spin text-brand-600" aria-hidden /> : job.auditId ? <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" aria-hidden /> : <XCircle className="h-5 w-5 shrink-0 text-red-600" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{running ? `Auditing ${hostOf(/^https?:/i.test(job.url) ? job.url : `https://${job.url}`)}` : headline(job)}</p>
            <p className="truncate text-xs text-slate-500">
              {running ? `${job.currentStage?.label || "Starting"} · ${job.percent}% of stages · ${fmtElapsed(elapsed)}` : job.error?.message || "Report ready"}
            </p>
          </div>
          {running ? (
            <button onClick={onExpand} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Show audit progress"><ChevronUp className="h-4 w-4" /></button>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              {job.auditId && <a href={`/audits/${job.auditId}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50">Open <ExternalLink className="h-3 w-3" aria-hidden /></a>}
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Dismiss"><XCircle className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function ProgressRing({ pct, running, failed }: { pct: number; running: boolean; failed: boolean }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0" aria-hidden>
      {running && (
        <svg viewBox="0 0 64 64" className="absolute inset-0 h-16 w-16 motion-safe:animate-spin">
          <circle cx="32" cy="32" r="31" fill="none" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" strokeDasharray="30 165" />
        </svg>
      )}
      <svg viewBox="0 0 64 64" className="h-16 w-16">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={failed ? "#dc2626" : "#2563eb"} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.max(0.02, pct / 100))} transform="rotate(-90 32 32)" className="transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-800">{pct}%</span>
    </div>
  );
}
