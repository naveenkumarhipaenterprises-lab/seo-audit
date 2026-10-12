"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, Loader2, MinusCircle, RotateCcw, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { STAGES, type AuditEvent, type StageState } from "@/lib/audit/types";
import { streamAudit } from "@/lib/client/run-audit";
import { cn } from "@/lib/utils";

type Phase = "idle" | "running" | "error" | "done";
const splitList = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

/** Client-side check mirroring the server rules, for instant feedback only. The server re-validates everything. */
function quickValidate(u: string): string | null {
  const raw = u.trim();
  if (!raw) return "Enter a website URL.";
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol)) return "Only http and https URLs are supported.";
    if (!url.hostname.includes(".")) return "Use a fully qualified public domain name.";
  } catch {
    return "That does not look like a valid URL.";
  }
  return null;
}

export function AuditForm({ renderingAvailable, compact = false }: { renderingAvailable: boolean; compact?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [secondary, setSecondary] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [advanced, setAdvanced] = useState(!compact);
  const [respectRobots, setRespectRobots] = useState(true);
  const [renderJs, setRenderJs] = useState(renderingAvailable);
  const [runPerformance, setRunPerformance] = useState(true);
  const [checkExternal, setCheckExternal] = useState(false);
  const [linksToCheck, setLinksToCheck] = useState(20);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [stages, setStages] = useState<StageState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number>(0);
  const [elapsed, setElapsed] = useState(0);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const finished = stages.filter((s) => s.status === "done" || s.status === "skipped" || s.status === "failed").length;
  const pct = Math.round((finished / STAGES.length) * 100);
  const current = stages.find((s) => s.status === "running");

  async function start(e?: React.FormEvent) {
    e?.preventDefault();
    const v = quickValidate(url);
    setFieldError(v);
    if (v) return;
    ctrl.current?.abort();
    const ac = new AbortController();
    ctrl.current = ac;
    setStages(STAGES.map((s) => ({ id: s.id, label: s.label, status: "pending" })));
    setError(null);
    setPhase("running");
    setStartedAt(Date.now());
    setElapsed(0);
    let completedId: string | null = null;
    try {
      await streamAudit(
        {
          url, primaryKeyword: keyword, secondaryKeywords: splitList(secondary), competitorUrls: splitList(competitors),
          respectRobots, renderJs: renderJs && renderingAvailable, runPerformance, enableAi: false, linksToCheck, checkExternalLinks: checkExternal,
        },
        (ev: AuditEvent) => {
          if (ev.type === "stage") setStages((prev) => prev.map((s) => (s.id === ev.stage ? { ...s, status: ev.status, detail: ev.detail } : s)));
          else if (ev.type === "error") {
            setError(ev.message);
            setPhase("error");
          } else if (ev.type === "done") completedId = ev.auditId;
        },
        ac.signal,
      );
      if (completedId) {
        setPhase("done");
        router.push(`/audits/${completedId}`);
        router.refresh();
      } else setPhase((p) => (p === "error" ? p : "error"));
    } catch (err) {
      if (ac.signal.aborted) {
        setError("The audit was cancelled.");
      } else setError((err as Error).message || "The audit could not be started.");
      setPhase("error");
    }
  }

  const busy = phase === "running" || phase === "done";
  return (
    <>
      <Card className="p-5 sm:p-6">
        <form onSubmit={start} noValidate className="space-y-5">
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div>
              <label htmlFor="url" className="mb-1.5 block text-sm font-medium text-slate-800">Website URL <span className="text-red-600">*</span></label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input id="url" name="url" inputMode="url" autoComplete="url" placeholder="https://www.example.com/page" value={url}
                  onChange={(e) => setUrl(e.target.value)} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? "url-error" : undefined}
                  className={cn("h-11 w-full rounded-lg border bg-white pl-9 pr-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100", fieldError ? "border-red-400" : "border-slate-300")} />
              </div>
              {fieldError && <p id="url-error" className="mt-1.5 text-sm text-red-600">{fieldError}</p>}
            </div>
            <div>
              <label htmlFor="kw" className="mb-1.5 block text-sm font-medium text-slate-800">Primary keyword <span className="font-normal text-slate-400">(optional)</span></label>
              <input id="kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={100} placeholder="e.g. organic spices"
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            </div>
          </div>

          <button type="button" onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-600" aria-expanded={advanced}>
            <ChevronDown className={cn("h-4 w-4 transition-transform", advanced && "rotate-180")} aria-hidden /> Advanced crawl settings
          </button>

          {advanced && (
            <div className="grid gap-6 rounded-lg border border-slate-200 bg-slate-50/60 p-4 lg:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <label htmlFor="sec" className="mb-1.5 block text-sm font-medium text-slate-800">Secondary keywords</label>
                  <textarea id="sec" rows={2} value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder="Comma or line separated (max 10)"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
                </div>
                <div>
                  <label htmlFor="comp" className="mb-1.5 block text-sm font-medium text-slate-800">Competitor URLs <span className="font-normal text-slate-400">(saved; comparison in Phase 3)</span></label>
                  <textarea id="comp" rows={2} value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="One per line (max 5)"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="links" className="mb-1.5 block text-sm font-medium text-slate-800">Links to check</label>
                    <input id="links" type="number" min={0} max={50} value={linksToCheck} onChange={(e) => setLinksToCheck(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500" />
                  </div>
                  <div>
                    <span className="mb-1.5 block text-sm font-medium text-slate-800">Max pages / depth</span>
                    <p className="flex h-10 items-center rounded-lg border border-dashed border-slate-300 px-3 text-xs text-slate-500">1 page (crawler in Phase 2)</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <Switch id="robots" label="Respect robots.txt" description="Stop if the site disallows our crawler." checked={respectRobots} onChange={setRespectRobots} />
                <Switch id="render" label="Enable JavaScript rendering" description={renderingAvailable ? "Headless Chromium at mobile, tablet and desktop widths." : "Not configured on this server."} checked={renderJs && renderingAvailable} onChange={setRenderJs} disabled={!renderingAvailable} />
                <Switch id="perf" label="Run mobile and desktop performance tests" description="Google PageSpeed Insights (slowest step)." checked={runPerformance} onChange={setRunPerformance} />
                <Switch id="ext" label="Check external links" description="Up to 10 outbound links." checked={checkExternal} onChange={setCheckExternal} />
                <Switch id="ai" label="Enable AI recommendations" description="No AI provider configured (Phase 3)." checked={false} onChange={() => {}} disabled />
                <Switch id="subdomains" label="Include subdomains" description="Applies to multi-page crawling (Phase 2)." checked={false} onChange={() => {}} disabled />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />} Start Complete Audit
            </Button>
            <p className="text-xs text-slate-500">Only public http/https sites. Private, local and internal addresses are blocked.</p>
          </div>
        </form>
      </Card>

      {phase !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="progress-title">
          <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="flex items-center gap-4">
              <ProgressRing pct={pct} spinning={phase === "running"} error={phase === "error"} />
              <div className="min-w-0">
                <h2 id="progress-title" className="text-lg font-semibold text-slate-900">{phase === "error" ? "Audit stopped" : phase === "done" ? "Opening report…" : "Auditing website"}</h2>
                <p className="truncate text-sm text-slate-500">{url}</p>
                <p className="mt-1 text-xs text-slate-500" aria-live="polite">
                  {finished} of {STAGES.length} stages finished · {elapsed}s elapsed
                </p>
              </div>
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Audit progress">
              <div className={cn("h-full rounded-full transition-[width] duration-500", phase === "error" ? "bg-red-500" : "bg-brand-600")} style={{ width: `${pct}%` }} />
            </div>
            {current && phase === "running" && <p className="mt-2 text-sm font-medium text-brand-700">{current.label}{current.detail ? ` — ${current.detail}` : ""}</p>}
            <ol className="mt-4 space-y-1.5">
              {stages.map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-sm">
                  <StageIcon status={s.status} />
                  <span className={cn("min-w-0", s.status === "pending" ? "text-slate-400" : "text-slate-700")}>
                    {s.label}
                    {s.detail && s.status !== "running" && <span className="block break-words text-xs text-slate-500">{s.detail}</span>}
                  </span>
                </li>
              ))}
            </ol>
            {error && (
              <div className="mt-4 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span className="break-words">{error}</span>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              {phase === "running" && <Button variant="secondary" onClick={() => ctrl.current?.abort()}>Cancel audit</Button>}
              {phase === "error" && (
                <>
                  <Button variant="secondary" onClick={() => setPhase("idle")}>Close</Button>
                  <Button onClick={() => start()}><RotateCcw className="h-4 w-4" aria-hidden /> Retry</Button>
                </>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function StageIcon({ status }: { status: StageState["status"] }) {
  const c = "mt-0.5 h-4 w-4 shrink-0";
  if (status === "done") return <CheckCircle2 className={cn(c, "text-green-600")} aria-label="Done" />;
  if (status === "running") return <Loader2 className={cn(c, "animate-spin text-brand-600")} aria-label="Running" />;
  if (status === "failed") return <XCircle className={cn(c, "text-red-600")} aria-label="Failed" />;
  if (status === "skipped") return <MinusCircle className={cn(c, "text-slate-400")} aria-label="Skipped" />;
  return <CircleDashed className={cn(c, "text-slate-300")} aria-label="Pending" />;
}

function ProgressRing({ pct, spinning, error }: { pct: number; spinning: boolean; error: boolean }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0">
      {spinning && (
        <svg viewBox="0 0 64 64" className="absolute inset-0 h-16 w-16 motion-safe:animate-spin" aria-hidden>
          <circle cx="32" cy="32" r="31" fill="none" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" strokeDasharray="30 165" />
        </svg>
      )}
      <svg viewBox="0 0 64 64" className="h-16 w-16" aria-hidden>
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={error ? "#dc2626" : "#2563eb"} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.max(0.04, pct / 100))} transform="rotate(-90 32 32)" className="transition-[stroke-dashoffset] duration-500" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-800">{pct}%</span>
    </div>
  );
}
