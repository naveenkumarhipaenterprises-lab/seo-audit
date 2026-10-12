"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertOctagon, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, CircleHelp, FileWarning, Globe2, Info, Minus } from "lucide-react";
import type { AuditRecord, Category, CheckResult } from "@/lib/audit/types";
import { CATEGORY_LABELS } from "@/lib/audit/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill, StatusBadge } from "@/components/ui/badge";
import { ScoreRing } from "./score-ring";
import { CheckItem, CheckList } from "./check-list";
import { ImageTable } from "./image-table";
import { ExportButtons } from "./export-buttons";
import { cn, formatDate, safeHref, scoreTone } from "@/lib/utils";
import type { AuditSummary } from "@/lib/store";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "seo", label: "Technical SEO" },
  { key: "images", label: "Images" },
  { key: "content", label: "Keywords & Content" },
  { key: "aeo", label: "AEO" },
  { key: "geo", label: "GEO" },
  { key: "performance", label: "Performance & Mobile" },
  { key: "methodology", label: "Methodology" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const SEV = { critical: 0, high: 1, medium: 2, low: 3 };
const byCat = (r: AuditRecord, ...cats: Category[]) => r.checks.filter((c) => cats.includes(c.category));
const fmt = (n: number | null) => (n === null ? "Not tested" : String(n));

export function ReportView({ record: r, previous }: { record: AuditRecord; previous: AuditSummary | null }) {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.key === params.get("tab"))?.key || "overview") as TabKey;
  const setTab = (k: TabKey) => router.replace(`?tab=${k}`, { scroll: false });
  const s = r.scores;
  const cats = s.categories;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Audit report</h1>
            {r.status === "partial" ? <Pill className="bg-amber-50 text-amber-800">Partial report</Pill> : <Pill className="bg-green-50 text-green-700">Complete</Pill>}
          </div>
          <a href={safeHref(r.finalUrl)} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 block break-all text-sm text-brand-700 hover:underline">{r.finalUrl}</a>
          <p className="mt-1 text-xs text-slate-500">Completed {formatDate(r.completedAt)} · Methodology {s.methodologyVersion} · HTTP {r.httpStatus}{r.redirects.length ? ` after ${r.redirects.length} redirect(s)` : ""}</p>
        </div>
        <ExportButtons id={r.id} />
      </div>

      {r.status === "partial" && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>Some analyses did not run or failed, so a few scores are based on fewer checks. Completed results are shown below. Details: {r.partialReasons.join(" ") || "see the Methodology tab."}</p>
        </div>
      )}

      <Card>
        <CardContent className="grid grid-cols-2 gap-6 py-6 sm:grid-cols-3 lg:grid-cols-6">
          <ScoreRing label="Overall Visibility" score={s.overall.score} sub="SEO + AEO + GEO" />
          <ScoreRing label="SEO Score" score={s.seo.score} />
          <ScoreRing label="AEO Score" score={cats.aeo.score} />
          <ScoreRing label="GEO Score" score={cats.geo.score} />
          <ScoreRing label="Performance" score={cats.performance.score} sub="Lighthouse (lab)" />
          <ScoreRing label="Mobile Usability" score={cats.mobile.score} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Pages crawled" value={r.pagesCrawled} icon={<Globe2 className="h-4 w-4 text-brand-600" />} />
        <Stat label="Errors" value={s.totals.errors} icon={<AlertOctagon className="h-4 w-4 text-red-600" />} />
        <Stat label="Warnings" value={s.totals.warnings} icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} />
        <Stat label="Passed checks" value={s.totals.passed} icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} />
        <Stat label="Not tested" value={s.totals.notTested} icon={<CircleHelp className="h-4 w-4 text-slate-400" />} />
      </div>

      {previous && <ScoreChanges record={r} previous={previous} />}

      <div className="no-print -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1 border-b border-slate-200" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", tab === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel">
        {tab === "overview" && <Overview r={r} />}
        {tab === "seo" && <Section title={CATEGORY_LABELS.technical} score={cats.technical.score}><CheckList checks={byCat(r, "technical")} /></Section>}
        {tab === "images" && (
          <div className="space-y-6">
            <Section title="Image SEO" score={cats.images.score}><CheckList checks={byCat(r, "images")} grouped={false} /></Section>
            <Card><CardHeader><CardTitle>Image inventory ({r.images.length})</CardTitle><CardDescription>Images found in the page HTML. Links open the original file in a new tab; images are not loaded into this app.</CardDescription></CardHeader><CardContent><ImageTable images={r.images} /></CardContent></Card>
          </div>
        )}
        {tab === "content" && <ContentTab r={r} />}
        {tab === "aeo" && <AeoTab r={r} />}
        {tab === "geo" && <GeoTab r={r} />}
        {tab === "performance" && <PerformanceTab r={r} />}
        {tab === "methodology" && <MethodologyTab r={r} />}
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">{icon}{label}</div>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </Card>
  );
}

function Section({ title, score, children, description }: { title: string; score?: number | null; children: React.ReactNode; description?: string }) {
  const tone = scoreTone(score ?? null);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</div>
        {score !== undefined && <span className={cn("rounded-lg px-3 py-1 text-sm font-semibold", tone.bg, tone.text)}>{fmt(score)}{score !== null && "/100"}</span>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ScoreChanges({ record: r, previous: p }: { record: AuditRecord; previous: AuditSummary }) {
  const rows: [string, number | null, number | null][] = [
    ["Overall", r.scores.overall.score, p.overall], ["SEO", r.scores.seo.score, p.seo], ["AEO", r.scores.categories.aeo.score, p.aeo], ["GEO", r.scores.categories.geo.score, p.geo], ["Performance", r.scores.categories.performance.score, p.performance],
  ];
  return (
    <Card>
      <CardHeader><CardTitle>Score changes</CardTitle><CardDescription>Compared with the previous audit of this URL on {formatDate(p.createdAt)}.</CardDescription></CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {rows.map(([label, now, before]) => {
          const d = now !== null && before !== null ? now - before : null;
          return (
            <div key={label} className="rounded-lg border border-slate-100 p-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="flex items-center gap-1 text-lg font-semibold">
                {fmt(now)}
                {d !== null && d !== 0 && <span className={cn("flex items-center text-sm", d > 0 ? "text-green-700" : "text-red-700")}>{d > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}{Math.abs(d)}</span>}
                {d === 0 && <Minus className="h-4 w-4 text-slate-400" aria-label="no change" />}
              </p>
              <p className="text-xs text-slate-400">was {fmt(before)}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function IssueList({ title, items, icon, empty }: { title: string; items: CheckResult[]; icon: React.ReactNode; empty: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2">{icon}{title} <span className="text-sm font-normal text-slate-400">({items.length})</span></CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : items.slice(0, 8).map((c) => <CheckItem key={c.id} c={c} />)}
        {items.length > 8 && <p className="text-xs text-slate-500">+{items.length - 8} more in the category tabs.</p>}
      </CardContent>
    </Card>
  );
}

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-slate-100 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-3 gap-3 py-2"><dt className="text-slate-500">{k}</dt><dd className="col-span-2 break-words text-slate-800">{v}</dd></div>
      ))}
    </dl>
  );
}

function Overview({ r }: { r: AuditRecord }) {
  const issues = r.checks.filter((c) => c.status === "fail" || c.status === "warning").sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const critical = issues.filter((c) => c.status === "fail" && c.severity === "critical");
  const high = issues.filter((c) => c.status === "fail" && c.severity === "high");
  const warnings = issues.filter((c) => c.status === "warning");
  const passed = r.checks.filter((c) => c.status === "pass");
  const p = r.page;
  const missingAlt = r.images.filter((i) => i.altState === "missing").length;
  const brokenImg = r.images.filter((i) => i.probe && ((i.probe.error && !i.probe.unverified) || (i.probe.status ?? 0) >= 400)).length;
  const idx = (id: string) => r.checks.find((c) => c.id === id);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <IssueList title="Critical issues" items={critical} icon={<AlertOctagon className="h-4 w-4 text-red-600" />} empty="No critical issues found." />
        <IssueList title="High-priority issues" items={high} icon={<FileWarning className="h-4 w-4 text-red-500" />} empty="No high-priority failures found." />
        <IssueList title="Warnings" items={warnings} icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} empty="No warnings." />
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" />Passed checks <span className="text-sm font-normal text-slate-400">({passed.length})</span></CardTitle></CardHeader>
          <CardContent><ul className="grid gap-1 text-sm text-slate-700 sm:grid-cols-2">{passed.map((c) => <li key={c.id} className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />{c.title}</li>)}</ul></CardContent>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Indexing information</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"><Info className="mt-0.5 h-4 w-4 shrink-0" />Google indexing status not verified — connect Google Search Console.</p>
            <KV rows={[
              ["HTTP status", `${r.httpStatus}`],
              ["robots.txt", idx("robots-allows-page")?.status === "fail" ? "Disallows Googlebot" : r.robots.status === "ok" ? "Allows Googlebot" : r.robots.status],
              ["Robots directives", p?.robotsMeta.join("; ") || p?.xRobotsTag || "None"],
              ["Canonical", p?.canonical || "Not set"],
              ["In sitemap", r.sitemap.includesAuditedUrl === null ? "Not determined" : r.sitemap.includesAuditedUrl ? "Yes" : "No"],
            ]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Metadata summary</CardTitle></CardHeader>
          <CardContent>
            <KV rows={[
              ["Title", p?.title ? <>{p.title} <span className="text-xs text-slate-400">({p.title.length} chars)</span></> : <span className="text-red-700">Missing</span>],
              ["Description", p?.metaDescription ? <>{p.metaDescription} <span className="text-xs text-slate-400">({p.metaDescription.length} chars)</span></> : <span className="text-amber-700">Missing</span>],
              ["H1", p?.headings.filter((h) => h.level === 1).map((h) => h.text).join(" | ") || <span className="text-red-700">Missing</span>],
              ["Headings", `${p?.headings.length ?? 0} total`],
              ["Structured data", r.structuredData.types.join(", ") || "None found"],
            ]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Image SEO summary</CardTitle></CardHeader>
          <CardContent><KV rows={[["Images found", r.images.length], ["Missing ALT", missingAlt], ["Empty ALT (decorative)", r.images.filter((i) => i.altState === "empty").length], ["Broken (of checked)", `${brokenImg} of ${r.images.filter((i) => i.probe).length}`], ["Over 500 KB", r.images.filter((i) => (i.probe?.bytes ?? 0) > 512000).length]]} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Mobile and desktop performance</CardTitle></CardHeader>
          <CardContent>
            <KV rows={r.performance.map((perf) => [perf.strategy === "mobile" ? "Mobile" : "Desktop", perf.status === "ok" ? <>{perf.score}/100 · LCP {perf.lab.LCP?.display ?? "n/a"} · CLS {perf.lab.CLS?.display ?? "n/a"} · TBT {perf.lab.TBT?.display ?? "n/a"}</> : <span className="text-slate-500">Not tested: {perf.error}</span>])} />
            <p className="mt-2 text-xs text-slate-500">Lab data from Lighthouse via PageSpeed Insights. Field data is on the Performance tab.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Keyword analysis</CardTitle></CardHeader>
          <CardContent>
            {r.keyword ? (
              <>
                <p className="mb-2 text-sm">Primary keyword: <span className="font-medium">{r.keyword.primary}</span> · {r.keyword.occurrences} occurrence(s)</p>
                <div className="flex flex-wrap gap-1.5">{r.keyword.placements.map((pl) => <span key={pl.location} className={cn("rounded-md px-2 py-0.5 text-xs", pl.found ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500")}>{pl.found ? "✓" : "✗"} {pl.location}</span>)}</div>
                <p className="mt-3 text-xs text-slate-500">Unavailable (no data provider connected): {r.keyword.unavailable.join(", ")}.</p>
              </>
            ) : <p className="text-sm text-slate-500">No target keyword was entered for this audit.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>AEO and GEO recommendations</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {[...byCat(r, "aeo"), ...byCat(r, "geo")].filter((c) => c.status === "warning" || c.status === "fail").sort((a, b) => SEV[a.severity] - SEV[b.severity]).slice(0, 6).map((c) => (
              <p key={c.id} className="flex gap-2"><StatusBadge status={c.status} /><span><span className="font-medium">{c.title}:</span> {c.recommendation}</span></p>
            ))}
            {[...byCat(r, "aeo"), ...byCat(r, "geo")].every((c) => c.status !== "warning" && c.status !== "fail") && <p className="text-slate-500">No AEO or GEO issues found.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ContentTab({ r }: { r: AuditRecord }) {
  return (
    <div className="space-y-6">
      {r.keyword && (
        <Card>
          <CardHeader><CardTitle>Keyword placement: “{r.keyword.primary}”</CardTitle><CardDescription>Whole-phrase, case-insensitive matching. Density ~{r.keyword.density}% (shown for awareness; there is no ideal value).</CardDescription></CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {r.keyword.placements.map((p) => (
                <div key={p.location} className={cn("rounded-lg border p-3", p.found ? "border-green-200 bg-green-50" : "border-slate-200 bg-slate-50")}>
                  <p className="text-xs text-slate-500">{p.location}</p>
                  <p className={cn("font-medium", p.found ? "text-green-700" : "text-slate-600")}>{p.found ? "Found" : "Not found"}{p.detail ? ` · ${p.detail}` : ""}</p>
                </div>
              ))}
            </div>
            {r.keyword.secondaryResults.length > 0 && (
              <table className="mt-4 w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Secondary keyword</th><th>In body</th><th>In headings</th><th>Occurrences</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{r.keyword.secondaryResults.map((s) => <tr key={s.keyword}><td className="py-1.5">{s.keyword}</td><td>{s.inBody ? "Yes" : "No"}</td><td>{s.inHeadings ? "Yes" : "No"}</td><td>{s.occurrences}</td></tr>)}</tbody></table>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              {r.keyword.unavailable.map((u) => <div key={u} className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500"><span className="block font-medium text-slate-700">{u}</span>Unavailable — connect a keyword data provider</div>)}
            </div>
          </CardContent>
        </Card>
      )}
      <Section title={CATEGORY_LABELS.content} score={r.scores.categories.content.score}><CheckList checks={byCat(r, "content")} /></Section>
    </div>
  );
}

function AeoTab({ r }: { r: AuditRecord }) {
  const sg = r.suggestions;
  return (
    <div className="space-y-6">
      <Section title="AEO readiness" score={r.scores.categories.aeo.score} description="How clearly the page answers likely questions. This does not indicate whether the page is shown in any answer engine.">
        <CheckList checks={byCat(r, "aeo")} />
      </Section>
      <Card>
        <CardHeader><CardTitle>Suggested questions and answer blocks</CardTitle><CardDescription>{sg.note}</CardDescription></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {sg.questions.length === 0 && sg.answerBlocks.length === 0 && <p className="text-slate-500">Enter a primary keyword to get rule-based question suggestions.</p>}
          {sg.questions.length > 0 && <ul className="list-disc space-y-1 pl-5">{sg.questions.map((q) => <li key={q}>{q}</li>)}</ul>}
          {sg.answerBlocks.length > 0 && <ul className="list-disc space-y-1 pl-5">{sg.answerBlocks.map((q) => <li key={q}>{q}</li>)}</ul>}
          <p className="text-xs text-slate-500">AI-generated drafts are not available: no AI provider is configured.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function GeoTab({ r }: { r: AuditRecord }) {
  const crawl = r.checks.filter((c) => ["noindex", "robots-allows-page", "canonical-target", "sitemap-found", "http-status"].includes(c.id));
  return (
    <div className="space-y-6">
      <div className="flex gap-2 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm text-brand-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>A technical crawl cannot show whether ChatGPT, Gemini, Perplexity or other AI systems mention or cite this brand. No AI visibility percentages or citation counts are estimated.</p>
      </div>
      <Section title="GEO readiness" score={r.scores.categories.geo.score}><CheckList checks={byCat(r, "geo")} /></Section>
      <Card>
        <CardHeader><CardTitle>Crawler access per robots.txt</CardTitle><CardDescription>Rules for each documented crawler token as applied to this URL. Firewall/CDN rules are not visible to this check, and operators differ in how they honour robots.txt.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Token</th><th>Operator</th><th>robots.txt</th><th>Purpose</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {r.aiCrawlers.map((a) => (
                <tr key={a.agent}><td className="py-2 font-mono text-xs">{a.agent}</td><td>{a.operator}</td>
                  <td>{a.allowed === null ? <span className="text-slate-400">Not evaluated</span> : a.allowed ? <span className="text-green-700">Allowed</span> : <span className="font-medium text-red-700">Disallowed</span>}{a.hasGroup && <span className="ml-1 text-xs text-slate-400">(own rules)</span>}</td>
                  <td className="text-slate-600">{a.purpose}</td></tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Section title="Crawl accessibility signals (scored under Technical SEO)"><div className="space-y-2">{crawl.map((c) => <CheckItem key={c.id} c={c} />)}</div></Section>
    </div>
  );
}

function PerformanceTab({ r }: { r: AuditRecord }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {r.performance.map((p) => (
          <Card key={p.strategy}>
            <CardHeader className="flex-row items-center justify-between"><CardTitle>{p.strategy === "mobile" ? "Mobile" : "Desktop"} performance</CardTitle><span className={cn("rounded-lg px-3 py-1 text-sm font-semibold", scoreTone(p.score).bg, scoreTone(p.score).text)}>{p.status === "ok" ? `${p.score}/100` : "Not tested"}</span></CardHeader>
            <CardContent>
              {p.status !== "ok" ? <p className="text-sm text-slate-500">{p.error}</p> : (
                <>
                  <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Lab data (Lighthouse {p.lighthouseVersion})</p>
                  <KV rows={Object.entries(p.lab).map(([k, v]) => [k, v.display ?? "Unavailable"])} />
                  <p className="mt-4 mb-1 text-xs font-semibold uppercase text-slate-500">Field data (Chrome UX Report, p75)</p>
                  {p.field.source === "none" ? <p className="text-sm text-slate-500">Unavailable: not enough real-user data for this URL or origin. INP is not shown.</p> : (
                    <>
                      <p className="mb-1 text-xs text-slate-500">{p.field.source === "origin" ? "Origin-level data (whole site), not this URL." : "URL-level data."} Overall: {p.field.overall ?? "n/a"}</p>
                      <KV rows={Object.entries(p.field.metrics).map(([k, m]) => [k, `${m.p75 ?? "n/a"}${k === "CLS" ? "" : " ms"} · ${m.category ?? "n/a"}`])} />
                    </>
                  )}
                  {p.opportunities.length > 0 && (
                    <>
                      <p className="mt-4 mb-1 text-xs font-semibold uppercase text-slate-500">Top opportunities</p>
                      <ul className="space-y-1 text-sm">{p.opportunities.map((o) => <li key={o.id} className="flex justify-between gap-2"><span>{o.title}</span><span className="shrink-0 text-slate-500">{o.display}</span></li>)}</ul>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {r.render.viewports.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Rendered viewport tests</CardTitle><CardDescription>Headless Chromium. Basic automated checks, not a full mobile usability certification.</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Viewport</th><th>Horizontal overflow</th><th>Small text</th><th>Small tap targets</th><th>Wide images</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{r.render.viewports.map((v) => <tr key={v.name}><td className="py-2">{v.name} ({v.width}px)</td><td className={v.horizontalOverflow ? "text-red-700" : "text-green-700"}>{v.horizontalOverflow ? `Yes (${v.scrollWidth}px)` : "No"}</td><td>{Math.round(v.smallTextRatio * 100)}%</td><td>{v.smallTapTargets} / {v.tapTargetsChecked}</td><td>{v.imagesWiderThanViewport}</td></tr>)}</tbody></table>
          </CardContent>
        </Card>
      )}
      <Section title="Mobile usability" score={r.scores.categories.mobile.score}><CheckList checks={byCat(r, "mobile")} grouped={false} /></Section>
      <Section title="Performance checks" score={r.scores.categories.performance.score}><CheckList checks={byCat(r, "performance")} grouped={false} /></Section>
    </div>
  );
}

function MethodologyTab({ r }: { r: AuditRecord }) {
  const s = r.scores;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>How the scores are calculated</CardTitle><CardDescription>Version {s.methodologyVersion}. This is SearchScope&apos;s diagnostic model, not an official Google, ChatGPT or other search engine score.</CardDescription></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-700">{s.overall.formula}</p>
          <p>Each check is worth points by severity (critical 10, high 6, medium 3, low 1). Pass earns full points, warning half, fail none. Not applicable, informational and not-tested checks are excluded. Every check belongs to exactly one category, so the same issue is not penalised twice. Performance uses the Lighthouse score directly.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Overall component</th><th>Score</th><th>Weight</th><th>Effective</th><th>Contribution</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{s.overall.components.map((c) => <tr key={c.name}><td className="py-2">{c.name}</td><td>{fmt(c.score)}</td><td>{c.weight}%</td><td>{c.effectiveWeight}%</td><td>{c.contribution ?? "—"}</td></tr>)}
                <tr className="font-semibold"><td className="py-2">Overall</td><td>{fmt(s.overall.score)}</td><td /><td /><td /></tr></tbody></table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Category</th><th>Score</th><th>Points</th><th>Pass</th><th>Warn</th><th>Fail</th><th>Not tested</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{Object.values(s.categories).map((c) => <tr key={c.category}><td className="py-2">{c.label}</td><td>{fmt(c.score)}</td><td>{c.category === "performance" ? "Lighthouse" : `${c.earned}/${c.possible}`}</td><td>{c.counts.pass}</td><td>{c.counts.warning}</td><td>{c.counts.fail}</td><td>{c.counts.not_tested}</td></tr>)}</tbody></table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Limitations and unavailable data</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="list-disc space-y-1 pl-5">{r.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          <KV rows={[["PageSpeed Insights", r.integrations.pagespeed], ["Google Search Console", r.integrations.searchConsole], ["Browser rendering", r.integrations.rendering], ["AI provider", r.integrations.ai], ["Keyword data", r.integrations.keywordData]]} />
        </CardContent>
      </Card>
    </div>
  );
}
