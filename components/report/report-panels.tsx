"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Info, Loader2, Minus, RotateCcw } from "lucide-react";
import type { AuditRecord, CompetitorSnapshot, PageInventoryItem, SearchConsoleResult } from "@/lib/audit/types";
import { CATEGORY_LABELS } from "@/lib/audit/types";
import type { AuditComparison } from "@/lib/audit/compare";
import { SNAPSHOT_CATEGORIES } from "@/lib/audit/snapshot-categories";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatDate, safeHref } from "@/lib/utils";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "Not tested" : String(n));

export function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-slate-100 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-3 gap-3 py-2"><dt className="text-slate-500">{k}</dt><dd className="col-span-2 break-words text-slate-800">{v}</dd></div>
      ))}
    </dl>
  );
}

export function ExtLink({ href, children }: { href: string; children?: React.ReactNode }) {
  const safe = safeHref(href);
  if (!safe) return <span className="break-all">{children ?? href}</span>;
  return <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-700 hover:underline">{children ?? href}</a>;
}

export function ComparisonCard({ cmp }: { cmp: AuditComparison }) {
  const [open, setOpen] = useState<"new" | "resolved" | "unchanged" | null>(null);
  const lists = { new: cmp.newIssues, resolved: cmp.resolvedIssues, unchanged: cmp.unchangedIssues };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Compared with the previous audit</CardTitle>
        <CardDescription>
          Previous audit of this URL on {formatDate(cmp.previousDate)}. Only real stored audits are compared.
          {!cmp.sameMode && " The two audits used different modes, so page and site-wide differences may come from the scope change."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {cmp.scores.map(({ label, now, before }) => {
            const d = now !== null && before !== null ? now - before : null;
            return (
              <div key={label} className="rounded-lg border border-slate-100 p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="flex items-center gap-1 text-lg font-semibold">
                  {fmt(now)}
                  {d !== null && d !== 0 && <span className={cn("flex items-center text-sm", d > 0 ? "text-green-700" : "text-red-700")}>{d > 0 ? <ArrowUpRight className="h-4 w-4" aria-label="up" /> : <ArrowDownRight className="h-4 w-4" aria-label="down" />}{Math.abs(d)}</span>}
                  {d === 0 && <Minus className="h-4 w-4 text-slate-400" aria-label="no change" />}
                </p>
                <p className="text-xs text-slate-400">was {fmt(before)}</p>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {(["new", "resolved", "unchanged"] as const).map((k) => (
            <button key={k} onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}
              className={cn("rounded-lg border px-3 py-1.5", open === k ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-700 hover:bg-slate-50")}>
              {k === "new" ? "New issues" : k === "resolved" ? "Resolved issues" : "Unchanged issues"}: <span className="font-semibold">{lists[k].length}</span>
            </button>
          ))}
          <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700">Pages added: <span className="font-semibold">{cmp.pagesAdded.length}</span></span>
          <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700">Pages removed: <span className="font-semibold">{cmp.pagesRemoved.length}</span></span>
        </div>
        {cmp.notRetested.length > 0 && <p className="text-xs text-slate-500">{cmp.notRetested.length} earlier issue(s) were not re-tested this time, so they are not counted as resolved.</p>}
        {open && (
          <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-100 p-3 text-sm">
            {lists[open].length === 0 ? <li className="text-slate-500">None.</li> : lists[open].map((c) => <li key={c.id}><span className="font-medium">{c.title}</span> <span className="text-xs text-slate-500">({CATEGORY_LABELS[c.category]}, {c.severity})</span></li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const isBlocked = (p: PageInventoryItem) => Boolean(p.error?.startsWith("Blocked by robots"));
type PageFilter = "all" | "issues" | "errors" | "noindex" | "redirected";

export function PagesTable({ pages }: { pages: PageInventoryItem[] }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<PageFilter>("all");
  const tests: Record<PageFilter, (p: PageInventoryItem) => boolean> = {
    all: () => true,
    issues: (p) => p.issues.length > 0,
    errors: (p) => (Boolean(p.error) && !isBlocked(p)) || (p.status ?? 0) >= 400,
    noindex: (p) => p.noindex || p.indexable === false,
    redirected: (p) => p.redirects > 0,
  };
  const rows = useMemo(() => {
    const n = q.toLowerCase();
    return pages.filter((p) => tests[f](p) && (!n || p.finalUrl.toLowerCase().includes(n) || (p.title || "").toLowerCase().includes(n)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, q, f]);
  if (!pages.length) return <p className="text-sm text-slate-500">No page inventory for this audit.</p>;
  const LABELS: Record<PageFilter, string> = { all: "All", issues: "With issues", errors: "Errors", noindex: "Not indexable", redirected: "Redirected" };
  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search URL or title" aria-label="Search pages"
          className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-500 sm:max-w-xs" />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter pages">
          {(Object.keys(LABELS) as PageFilter[]).map((k) => (
            <button key={k} onClick={() => setF(k)} aria-pressed={f === k}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium", f === k ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600")}>
              {LABELS[k]} ({pages.filter(tests[k]).length})
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[900px] text-left text-sm">
          <caption className="sr-only">Pages analysed in this audit</caption>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">URL</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Depth</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">H1</th><th className="px-3 py-2">Words</th><th className="px-3 py-2">Inlinks</th><th className="px-3 py-2">Indexability signals</th><th className="px-3 py-2">Issues</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => (
              <tr key={`${p.url}|${p.finalUrl}`} className="align-top">
                <td className="max-w-xs px-3 py-2"><ExtLink href={p.finalUrl} />{p.redirects > 0 && <span className="block text-xs text-amber-700">{p.redirects} redirect(s) from {p.url}</span>}<span className="block text-xs text-slate-400">found via {p.foundVia}</span></td>
                <td className={cn("px-3 py-2", isBlocked(p) ? "text-slate-500" : p.error || (p.status ?? 0) >= 400 ? "font-medium text-red-700" : "text-slate-700")}>{isBlocked(p) ? "Not fetched" : p.status ?? "—"}{p.error && <span className="block text-xs font-normal">{p.error}</span>}</td>
                <td className="px-3 py-2 text-slate-600">{p.depth}</td>
                <td className="max-w-[14rem] px-3 py-2">{p.title ? <span className="break-words">{p.title}</span> : <span className="text-red-700">Missing</span>}</td>
                <td className="max-w-[12rem] px-3 py-2">{p.h1 ? <span className="break-words">{p.h1}</span> : <span className="text-red-700">Missing</span>}{p.h1Count > 1 && <span className="block text-xs text-amber-700">{p.h1Count} H1s</span>}</td>
                <td className="px-3 py-2 text-slate-600">{p.wordCount}</td>
                <td className="px-3 py-2 text-slate-600">{p.inlinks}</td>
                <td className="px-3 py-2">{p.indexable === null ? <span className="text-slate-400">Unknown</span> : p.indexable ? <span className="text-green-700">Indexable signals</span> : <span className="text-amber-700">{p.noindex ? "noindex" : "Not indexable"}</span>}</td>
                <td className="px-3 py-2 text-xs text-slate-600">{p.issues.length ? <ul className="list-disc pl-4">{p.issues.slice(0, 5).map((i) => <li key={i}>{i}</li>)}</ul> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Indexability is based on HTTP status, robots directives and canonical tags only. It is not Google&apos;s actual index status.</p>
    </div>
  );
}

export function CompetitorsTable({ site, competitors }: { site?: CompetitorSnapshot; competitors: CompetitorSnapshot[] }) {
  if (!competitors.length) return null;
  const cols = [site, ...competitors].filter(Boolean) as CompetitorSnapshot[];
  const row = (label: string, get: (s: CompetitorSnapshot) => React.ReactNode) => (
    <tr key={label}><th scope="row" className="py-2 pr-3 text-left font-normal text-slate-500">{label}</th>{cols.map((s, i) => <td key={i} className="px-3 py-2">{s.status === "ok" ? get(s) : "—"}</td>)}</tr>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Competitor comparison</CardTitle>
        <CardDescription>Each home page was fetched once and scored with the same on-page checks (no link probes, rendering or PageSpeed), so these scores differ from the full scores above. No traffic, ranking or backlink data is estimated.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr><th className="py-2 text-left">Signal</th>{cols.map((s, i) => <th key={i} className="px-3 py-2 text-left normal-case"><ExtLink href={s.finalUrl || s.url}>{i === 0 && site ? "This site" : new URL(s.url).hostname}</ExtLink>{s.status !== "ok" && <span className="block text-xs font-normal text-red-700">{s.status === "blocked" ? "Not fetched" : "Error"}: {s.error}</span>}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {SNAPSHOT_CATEGORIES.map((c) => row(CATEGORY_LABELS[c], (s) => fmt(s.scores[c])))}
            {row("HTTP status", (s) => s.httpStatus)}
            {row("Response time", (s) => (s.responseTimeMs === null ? "—" : `${s.responseTimeMs} ms`))}
            {row("Title", (s) => s.title || <span className="text-red-700">Missing</span>)}
            {row("Meta description", (s) => (s.metaDescription ? "Present" : "Missing"))}
            {row("H1 count", (s) => s.h1Count)}
            {row("Main content words", (s) => s.wordCount)}
            {row("Schema types", (s) => s.schemaTypes.join(", ") || "None")}
            {row("Images missing ALT", (s) => `${s.imagesMissingAlt} of ${s.images}`)}
            {row("HTTPS", (s) => (s.https ? "Yes" : "No"))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Fetched {formatDate(competitors[0].fetchedAt)}.</p>
      </CardContent>
    </Card>
  );
}

export function SearchConsolePanel({ gsc }: { gsc?: SearchConsoleResult }) {
  if (!gsc || gsc.status !== "ok") {
    return (
      <Card>
        <CardHeader><CardTitle>Google Search Console</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-amber-900"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Not verified through Search Console. {gsc?.message || "Search Console was not used for this audit."}</p>
          <p className="text-xs text-slate-500">Clicks, impressions, CTR, average position and Google&apos;s index status are only shown when you connect Search Console in Settings and the site is a verified property in your account.</p>
        </CardContent>
      </Card>
    );
  }
  const t = gsc.totals;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Search Console</CardTitle>
        <CardDescription>Property {gsc.property} · {gsc.dateRange ? `${gsc.dateRange.start} to ${gsc.dateRange.end}` : ""} · retrieved {gsc.retrievedAt ? formatDate(gsc.retrievedAt) : "—"}. Data from Google; not estimated.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {t && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Clicks", t.clicks.toLocaleString()], ["Impressions", t.impressions.toLocaleString()], ["CTR", pct(t.ctr)], ["Avg. position", t.position.toFixed(1)]].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-100 p-3"><p className="text-xs text-slate-500">{k} (property)</p><p className="text-lg font-semibold">{v}</p></div>
            ))}
          </div>
        )}
        {gsc.pageTotals !== undefined && (
          <p className="text-slate-700">This URL: {gsc.pageTotals ? `${gsc.pageTotals.clicks} clicks, ${gsc.pageTotals.impressions} impressions, CTR ${pct(gsc.pageTotals.ctr)}, average position ${gsc.pageTotals.position.toFixed(1)}` : "no search data for this exact URL in the date range."}</p>
        )}
        {gsc.inspection && (
          <KV rows={[
            ["Index verdict", gsc.inspection.error ? `Unavailable: ${gsc.inspection.error}` : gsc.inspection.verdict || "—"],
            ["Coverage", gsc.inspection.coverageState || "—"],
            ["Last crawl", gsc.inspection.lastCrawlTime ? formatDate(gsc.inspection.lastCrawlTime) : "—"],
            ["Google-selected canonical", gsc.inspection.googleCanonical || "—"],
          ]} />
        )}
        {gsc.topQueries && gsc.topQueries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left">
              <caption className="mb-1 text-left text-xs font-semibold uppercase text-slate-500">Top queries for this URL</caption>
              <thead className="text-xs text-slate-500"><tr><th className="py-1">Query</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{gsc.topQueries.map((q) => <tr key={q.query}><td className="py-1.5">{q.query}</td><td>{q.clicks}</td><td>{q.impressions}</td><td>{pct(q.ctr)}</td><td>{q.position.toFixed(1)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {gsc.limitations.length > 0 && <ul className="list-disc pl-5 text-xs text-slate-500">{gsc.limitations.map((l) => <li key={l}>{l}</li>)}</ul>}
      </CardContent>
    </Card>
  );
}

export function RetryPerformanceButton({ r }: { r: AuditRecord }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [msg, setMsg] = useState("");
  const needsRetry = r.input.runPerformance && r.performance.some((p) => p.status !== "ok");
  if (!needsRetry) return null;
  async function retry() {
    setState("loading");
    setMsg("");
    try {
      const res = await fetch(`/api/audits/${r.id}/performance`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setState("done");
      setMsg(body.ok > 0 ? `PageSpeed returned results for ${body.ok} test(s).` : "PageSpeed Insights still returned no results. See the messages below.");
      router.refresh();
    } catch (e) {
      setState("error");
      setMsg((e as Error).message);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" onClick={retry} disabled={state === "loading"}>
        {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
        {state === "loading" ? "Re-running PageSpeed tests…" : "Retry performance test"}
      </Button>
      {msg && <p className={cn("text-sm", state === "error" ? "text-red-700" : "text-slate-600")} role="status">{msg}</p>}
    </div>
  );
}

