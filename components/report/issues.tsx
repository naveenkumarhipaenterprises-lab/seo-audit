"use client";
import { useMemo, useState } from "react";
import type { CheckResult, IssueState } from "@/lib/audit/types";
import { prioritizedIssues } from "@/lib/scoring/score";
import { CheckItem } from "./check-list";
import { cn } from "@/lib/utils";

type Filter = "all" | "critical" | "high" | "medium" | "low" | "fixed" | "skipped" | "ignored";
const STATE_LABEL: Record<IssueState, string> = { open: "Open", ignored: "Ignored", not_applicable: "Not applicable" };

/**
 * Issue manager: prioritised open issues with filters, per-issue review state (stored with
 * the audit; scores are unchanged) and "Fixed" issues derived from the previous real audit.
 */
export function IssueManager({ auditId, checks, fixed, initialStates }: { auditId: string; checks: CheckResult[]; fixed: CheckResult[] | null; initialStates: Record<string, IssueState> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [states, setStates] = useState(initialStates);
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const issues = useMemo(() => prioritizedIssues(checks), [checks]);
  const open = issues.filter((c) => !states[c.id]);
  const skipped = checks.filter((c) => c.status === "not_tested");
  const ignored = issues.filter((c) => states[c.id]);
  const list: CheckResult[] =
    filter === "all" ? open
      : filter === "fixed" ? fixed || []
        : filter === "skipped" ? skipped
          : filter === "ignored" ? ignored
            : open.filter((c) => c.severity === filter);
  const counts: Record<Filter, number> = {
    all: open.length, critical: open.filter((c) => c.severity === "critical").length, high: open.filter((c) => c.severity === "high").length,
    medium: open.filter((c) => c.severity === "medium").length, low: open.filter((c) => c.severity === "low").length,
    fixed: fixed?.length ?? 0, skipped: skipped.length, ignored: ignored.length,
  };
  const FILTERS: [Filter, string][] = [["all", "All open issues"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["low", "Low"], ["fixed", "Fixed"], ["skipped", "Skipped or unavailable"], ["ignored", "Ignored / N/A"]];

  async function setState(checkId: string, state: IssueState) {
    setSaving(checkId);
    setErr(null);
    try {
      const res = await fetch(`/api/audits/${auditId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ checkId, state }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      setStates((await res.json()).issueStates);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter issues">
        {FILTERS.map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} disabled={k === "fixed" && fixed === null}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-50", filter === k ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
            {label} ({k === "fixed" && fixed === null ? "no previous audit" : counts[k]})
          </button>
        ))}
      </div>
      {err && <p className="mb-2 text-sm text-red-700" role="alert">Could not update the issue: {err}</p>}
      {filter === "fixed" && <p className="mb-2 text-xs text-slate-500">Issues from the previous audit of this URL that now pass.</p>}
      {filter === "skipped" && <p className="mb-2 text-xs text-slate-500">Checks that could not run (missing data, disabled options or unavailable services). They are not counted as passed or failed.</p>}
      {list.length === 0 ? <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">Nothing in this view.</p> : (
        <div className="space-y-2">
          {list.slice(0, 60).map((c) => {
            const st = states[c.id];
            const isIssue = c.status === "fail" || c.status === "warning";
            return (
              <CheckItem key={c.id} c={c} state={filter === "fixed" ? "Fixed" : st ? STATE_LABEL[st] : undefined}
                actions={isIssue && filter !== "fixed" ? (
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    Issue status
                    <select value={st || "open"} disabled={saving === c.id} onChange={(e) => setState(c.id, e.target.value as IssueState)}
                      className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs outline-none focus:border-brand-500">
                      <option value="open">Open</option><option value="ignored">Ignored</option><option value="not_applicable">Not applicable</option>
                    </select>
                    <span className="text-slate-400">Does not change scores.</span>
                  </label>
                ) : undefined} />
            );
          })}
          {list.length > 60 && <p className="text-xs text-slate-500">Showing the first 60 of {list.length}. The CSV export contains every finding.</p>}
        </div>
      )}
    </div>
  );
}
