"use client";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { CheckResult, CheckStatus } from "@/lib/audit/types";
import { SeverityBadge, StatusBadge } from "@/components/ui/badge";
import { cn, safeHref } from "@/lib/utils";

const ORDER: Record<CheckStatus, number> = { fail: 0, warning: 1, not_tested: 2, info: 3, pass: 4, not_applicable: 5 };
const SEV = { critical: 0, high: 1, medium: 2, low: 3 };
const FILTERS: { key: "all" | "issues" | CheckStatus; label: string }[] = [
  { key: "all", label: "All" }, { key: "issues", label: "Issues" }, { key: "pass", label: "Passed" }, { key: "not_tested", label: "Not tested" },
];

function Evidence({ text }: { text: string }) {
  // Render crawled text as plain text; only http(s) URLs become links (new tab, no referrer).
  const parts = text.split(/(https?:\/\/[^\s|,]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        const href = /^https?:\/\//.test(p) ? safeHref(p) : undefined;
        return href ? <a key={i} href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-700 underline decoration-brand-200 hover:decoration-brand-600">{p}</a> : <span key={i} className="break-words">{p}</span>;
      })}
    </>
  );
}

export function CheckItem({ c }: { c: CheckResult }) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white open:shadow-sm">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{c.title}</span>
            <StatusBadge status={c.status} />
            {(c.status === "fail" || c.status === "warning") && <SeverityBadge severity={c.severity} />}
          </div>
          <p className="mt-0.5 text-sm text-slate-600">{c.explanation}</p>
        </div>
      </summary>
      <div className="space-y-3 border-t border-slate-100 px-4 py-3 pl-11 text-sm">
        {c.evidence.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</p>
            <ul className="mt-1 space-y-1 font-mono text-xs text-slate-700">
              {c.evidence.map((e, i) => <li key={i} className="rounded bg-slate-50 px-2 py-1"><Evidence text={e} /></li>)}
            </ul>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended fix</p><p className="text-slate-700">{c.recommendation}</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detection method</p><p className="text-slate-700">{c.detection}</p></div>
        </div>
        {c.limitation && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900"><span className="font-semibold">Limitation:</span> {c.limitation}</p>}
        <p className="break-all text-xs text-slate-400">Affected URL: {c.url} · Check ID: {c.id}</p>
      </div>
    </details>
  );
}

export function CheckList({ checks, grouped = true, defaultFilter = "all" }: { checks: CheckResult[]; grouped?: boolean; defaultFilter?: "all" | "issues" }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>(defaultFilter);
  const list = useMemo(
    () => checks
      .filter((c) => filter === "all" || (filter === "issues" ? c.status === "fail" || c.status === "warning" : c.status === filter))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || SEV[a.severity] - SEV[b.severity]),
    [checks, filter],
  );
  const groups = grouped ? Array.from(new Set(checks.map((c) => c.group))) : [""];
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter checks">
        {FILTERS.map((f) => {
          const n = f.key === "all" ? checks.length : checks.filter((c) => (f.key === "issues" ? c.status === "fail" || c.status === "warning" : c.status === f.key)).length;
          return (
            <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter === f.key ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
              {f.label} ({n})
            </button>
          );
        })}
      </div>
      {list.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">No checks match this filter.</p>}
      {groups.map((g) => {
        const items = list.filter((c) => !grouped || c.group === g);
        if (!items.length) return null;
        return (
          <section key={g} className="mb-4">
            {grouped && <h3 className="mb-2 text-sm font-semibold text-slate-700">{g}</h3>}
            <div className="space-y-2">{items.map((c) => <CheckItem key={c.id} c={c} />)}</div>
          </section>
        );
      })}
    </div>
  );
}
