"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertOctagon, AlertTriangle, CheckCircle2, CircleHelp, Globe2, Info, MinusCircle, ShieldCheck } from "lucide-react";
import type { AuditRecord, Category } from "@/lib/audit/types";
import { CATEGORY_LABELS } from "@/lib/audit/types";
import type { AuditComparison } from "@/lib/audit/compare";
import { statusLabel } from "@/lib/audit/record-utils";
import { SCORE_NOTICE, SEO_COMPONENT_WEIGHTS, SEVERITY_WEIGHTS, OVERALL_WEIGHTS } from "@/lib/scoring/weights";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill, StatusBadge } from "@/components/ui/badge";
import { ScoreRing } from "./score-ring";
import { CheckItem, CheckList } from "./check-list";
import { ImageTable } from "./image-table";
import { ExportButtons } from "./export-buttons";
import { IssueManager } from "./issues";
import { ComparisonCard, CompetitorsTable, KV, PagesTable, RetryPerformanceButton, SearchConsolePanel } from "./report-panels";
import { cn, formatDate, safeHref, scoreTone } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "seo", label: "Technical SEO" },
  { key: "images", label: "Images" },
  { key: "content", label: "Keywords & Content" },
  { key: "aeo", label: "AEO" },
  { key: "geo", label: "GEO" },
  { key: "performance", label: "Performance & Mobile" },
  { key: "pages", label: "Pages" },
  { key: "methodology", label: "Methodology" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "SearchScope AI";
const SEV = { critical: 0, high: 1, medium: 2, low: 3 };
const byCat = (r: AuditRecord, ...cats: Category[]) => r.checks.filter((c) => cats.includes(c.category));
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "Not tested" : String(n));

const STATUS_TONE: Record<string, string> = {
  completed: "bg-green-50 text-green-700",
  completed_with_warnings: "bg-amber-50 text-amber-800",
  partial: "bg-amber-50 text-amber-800",
};

export function ReportView({ record: r, comparison, fixed }: { record: AuditRecord; comparison: AuditComparison | null; fixed: AuditRecord["checks"] | null }) {
  const params = useSearchParams();
  const router = useRouter();
  const full = r.input.mode === "full";
  const tabs = TABS.filter((t) => t.key !== "pages" || (r.pages?.length ?? 0) > 0);
  const tab = (tabs.find((t) => t.key === params.get("tab"))?.key || "overview") as TabKey;
  const setTab = (k: TabKey) => router.replace(`?tab=${k}`, { scroll: false });
  const s = r.scores;
  const cats = s.categories;
  const t = s.totals;
  const tested = t.tested ?? t.passed + t.warnings + t.errors;
  const pagesAnalysed = r.pages?.filter((p) => !p.error).length || r.pagesCrawled;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{APP_NAME}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Audit report</h1>
            <Pill className="bg-slate-100 text-slate-700">{full ? "Full Site Audit" : "Quick Audit"}</Pill>
            <Pill className={STATUS_TONE[r.status] || "bg-slate-100 text-slate-700"}>{statusLabel(r.status)}</Pill>
          </div>
          <a href={safeHref(r.finalUrl)} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 block break-all text-sm text-brand-700 hover:underline">{r.finalUrl}</a>
          <p className="mt-1 text-xs text-slate-500">
            Started {formatDate(r.createdAt)} · Completed {formatDate(r.completedAt)} · HTTP {r.httpStatus ?? "—"}{r.redirects.length ? ` after ${r.redirects.length} redirect(s)` : ""} · Methodology {s.methodologyVersion}{r.engineVersion ? ` · Engine ${r.engineVersion}` : ""}
          </p>
        </div>
        <ExportButtons id={r.id} url={r.finalUrl} />
      </header>

      <p className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"><Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />{SCORE_NOTICE}</p>

      {r.status === "partial" && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>Partially completed: some analyses did not run or failed, so a few scores are based on fewer checks. Completed results are shown below. {r.partialReasons.join(" ") || "See the Methodology tab."}</p>
        </div>
      )}
      {r.status !== "partial" && (r.warnings?.length ?? 0) > 0 && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div><p className="font-medium">Completed with warnings</p><ul className="mt-1 list-disc pl-5">{r.warnings!.map((w) => <li key={w}>{w}</li>)}</ul></div>
        </div>
      )}

      <Card>
        <CardContent className="grid grid-cols-2 gap-6 py-6 sm:grid-cols-3 lg:grid-cols-6">
          <ScoreRing label="Overall Health" score={s.overall.score} sub="SEO + AEO + GEO + A11y + Security" />
          <ScoreRing label="SEO Score" score={s.seo.score} />
          <ScoreRing label="AEO Readiness" score={cats.aeo.score} sub="Assessment" />
          <ScoreRing label="GEO Readiness" score={cats.geo.score} sub="Assessment" />
          <ScoreRing label="Performance" score={cats.performance.score} sub="Lighthouse (lab)" />
          <ScoreRing label="Mobile Usability" score={cats.mobile.score} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {(["technical", "onpage", "content", "images", "accessibility", "security"] as Category[]).map((c) => {
          const tone = scoreTone(cats[c]?.score ?? null);
          return (
            <Card key={c} className="p-3">
              <p className="text-xs font-medium text-slate-500">{CATEGORY_LABELS[c]}</p>
              <p className={cn("mt-1 text-xl font-semibold", tone.text)}>{fmt(cats[c]?.score)}</p>
            </Card>
          );
        })}
        <Stat label="Pages analysed" value={pagesAnalysed} icon={<Globe2 className="h-4 w-4 text-brand-600" />} />
        <Stat label="Checks tested" value={tested} icon={<ShieldCheck className="h-4 w-4 text-brand-600" />} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Passed" value={t.passed} icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} />
        <Stat label="Failed" value={t.errors} icon={<AlertOctagon className="h-4 w-4 text-red-600" />} />
        <Stat label="Warnings" value={t.warnings} icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} />
        <Stat label="Skipped / not tested" value={t.notTested} icon={<CircleHelp className="h-4 w-4 text-slate-400" />} />
        <Stat label="Not applicable" value={t.notApplicable ?? r.checks.filter((c) => c.status === "not_applicable").length} icon={<MinusCircle className="h-4 w-4 text-slate-400" />} />
      </div>

      {comparison && <ComparisonCard cmp={comparison} />}

      <div className="no-print -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1 border-b border-slate-200" role="tablist" aria-label="Report sections">
          {tabs.map((x) => (
            <button key={x.key} role="tab" id={`tab-${x.key}`} aria-controls="report-panel" aria-selected={tab === x.key} onClick={() => setTab(x.key)}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", tab === x.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" id="report-panel" aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <Overview r={r} fixed={fixed} />}
        {tab === "seo" && <SeoTab r={r} />}
        {tab === "images" && (
          <div className="space-y-6">
            <Section title="Image SEO" score={cats.images.score}><CheckList checks={byCat(r, "images")} grouped={false} /></Section>
            <Card>
              <CardHeader><CardTitle>Image inventory ({r.images.length})</CardTitle><CardDescription>Images found in the analysed HTML{full ? " across crawled pages" : ""}. Links open the original file in a new tab.</CardDescription></CardHeader>
              <CardContent><ImageTable images={r.images} /></CardContent>
            </Card>
          </div>
        )}
        {tab === "content" && <ContentTab r={r} />}
        {tab === "aeo" && <AeoTab r={r} />}
        {tab === "geo" && <GeoTab r={r} />}
        {tab === "performance" && <PerformanceTab r={r} />}
        {tab === "pages" && (
          <Card>
            <CardHeader>
              <CardTitle>Page inventory ({r.pages?.length ?? 0})</CardTitle>
              {r.crawl && r.crawl.enabled && (
                <CardDescription>
                  Discovered {r.crawl.discovered}, processed {r.crawl.processed}, failed {r.crawl.failed}, skipped by robots.txt {r.crawl.skippedRobots}, not crawled because of the limits {r.crawl.skippedOther}. Limits: {r.crawl.maxPages} pages, depth {r.crawl.maxDepth}. Stopped because: {STOP_REASON[r.crawl.stopReason]}.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent><PagesTable pages={r.pages || []} /></CardContent>
          </Card>
        )}
        {tab === "methodology" && <MethodologyTab r={r} />}
      </div>
    </div>
  );
}

const STOP_REASON: Record<string, string> = {
  complete: "every discoverable page within the limits was processed",
  page_limit: "the maximum page limit was reached",
  time_budget: "the crawl time budget was reached",
  cancelled: "the audit was cancelled",
  not_run: "the crawl did not run",
};

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">{icon}{label}</div>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
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

function Overview({ r, fixed }: { r: AuditRecord; fixed: AuditRecord["checks"] | null }) {
  const p = r.page;
  const missingAlt = r.images.filter((i) => i.altState === "missing").length;
  const brokenImg = r.images.filter((i) => i.probe && ((i.probe.error && !i.probe.unverified) || (i.probe.status ?? 0) >= 400)).length;
  const idx = (id: string) => r.checks.find((c) => c.id === id);
  const aeoGeo = [...byCat(r, "aeo"), ...byCat(r, "geo")].filter((c) => c.status === "warning" || c.status === "fail").sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const gscIndex = r.searchConsole?.status === "ok" && r.searchConsole.inspection && !r.searchConsole.inspection.error ? r.searchConsole.inspection : null;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Prioritised issues</CardTitle>
          <CardDescription>Ordered by severity, then failures before warnings, then the number of affected pages. Set an issue to Ignored or Not applicable to track your review; scores are not changed.</CardDescription>
        </CardHeader>
        <CardContent><IssueManager auditId={r.id} checks={r.checks} fixed={fixed} initialStates={r.issueStates || {}} /></CardContent>
      </Card>

      <CompetitorsTable site={r.siteSnapshot} competitors={r.competitors || []} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Indexing signals</CardTitle></CardHeader>
          <CardContent>
            {gscIndex ? (
              <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Google URL Inspection: {gscIndex.verdict || "—"}{gscIndex.coverageState ? ` · ${gscIndex.coverageState}` : ""}</p>
            ) : (
              <p className="mb-3 flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Not verified through Search Console. The signals below are what the page itself declares.</p>
            )}
            <KV rows={[
              ["HTTP status", `${r.httpStatus ?? "—"}`],
              ["robots.txt", idx("robots-allows-page")?.status === "fail" ? "Disallows Googlebot" : r.robots.status === "ok" ? "Allows Googlebot" : r.robots.status],
              ["Robots directives", p?.robotsMeta.join("; ") || p?.xRobotsTag || "None"],
              ["Canonical", p?.canonical || "Not set"],
              ["In sitemap", r.sitemap.includesAuditedUrl === null ? "Not determined" : r.sitemap.includesAuditedUrl ? "Yes" : "No"],
            ]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Metadata summary (start page)</CardTitle></CardHeader>
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
            {r.performance.length === 0 ? <p className="text-sm text-slate-500">Performance was not tested for this audit.</p> : (
              <KV rows={r.performance.map((perf) => [perf.strategy === "mobile" ? "Mobile" : "Desktop", perf.status === "ok" ? <>{perf.score}/100 · LCP {perf.lab.LCP?.display ?? "n/a"} · CLS {perf.lab.CLS?.display ?? "n/a"} · TBT {perf.lab.TBT?.display ?? "n/a"}</> : <span className="text-slate-500">Not tested: {perf.error}</span>])} />
            )}
            <p className="mt-2 text-xs text-slate-500">Lab data from Lighthouse via PageSpeed Insights. Field data is on the Performance tab.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>On-page keyword analysis</CardTitle></CardHeader>
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
          <CardHeader><CardTitle>AEO and GEO recommendations</CardTitle><CardDescription>Assessments based on page signals, not measured AI visibility.</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {aeoGeo.slice(0, 6).map((c) => (
              <p key={c.id} className="flex gap-2"><StatusBadge status={c.status} /><span><span className="font-medium">{c.title}:</span> {c.recommendation}</span></p>
            ))}
            {aeoGeo.length === 0 && <p className="text-slate-500">No AEO or GEO issues found.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SeoTab({ r }: { r: AuditRecord }) {
  const cats = r.scores.categories;
  const sec = r.security;
  return (
    <div className="space-y-6">
      {r.crawl?.enabled && (
        <Card>
          <CardHeader><CardTitle>Crawl summary</CardTitle><CardDescription>Same-site pages discovered from links and sitemaps, within the limits you set.</CardDescription></CardHeader>
          <CardContent>
            <KV rows={[
              ["Pages discovered", r.crawl.discovered], ["Pages processed", r.crawl.processed], ["Failed", r.crawl.failed],
              ["Skipped by robots.txt", r.crawl.skippedRobots], ["Not crawled (limits reached)", r.crawl.skippedOther], ["Sitemap URLs used as seeds", r.crawl.sitemapUrlsUsed],
              ["Limits", `${r.crawl.maxPages} pages, depth ${r.crawl.maxDepth}`], ["Stopped because", STOP_REASON[r.crawl.stopReason]],
              ["Duration", `${Math.round(r.crawl.durationMs / 1000)} s`],
            ]} />
          </CardContent>
        </Card>
      )}
      <Section title={CATEGORY_LABELS.technical} score={cats.technical.score}><CheckList checks={byCat(r, "technical")} /></Section>
      <Section title={CATEGORY_LABELS.onpage} score={cats.onpage?.score ?? null}><CheckList checks={byCat(r, "onpage")} /></Section>
      <SearchConsolePanel gsc={r.searchConsole} />
      <Section title={CATEGORY_LABELS.accessibility} score={cats.accessibility?.score ?? null} description="Automated HTML checks only. They cannot confirm full WCAG conformance; manual testing is still needed.">
        <CheckList checks={byCat(r, "accessibility")} grouped={false} />
      </Section>
      <Section title={CATEGORY_LABELS.security} score={cats.security?.score ?? null} description="Response headers and redirects observed for the start page. This is not a penetration test.">
        {sec && (
          <div className="mb-4">
            <KV rows={[
              ["HTTP → HTTPS", sec.httpRedirectsToHttps === null ? (sec.httpRefused ? "Plain HTTP is not served" : `Not determined${sec.httpCheckError ? `: ${sec.httpCheckError}` : ""}`) : sec.httpRedirectsToHttps ? "Redirects to HTTPS" : "Does not redirect"],
              ...Object.entries(sec.headers).map(([k, v]) => [k, v ? <span key={k} className="font-mono text-xs">{v.length > 160 ? v.slice(0, 159) + "…" : v}</span> : <span key={k} className="text-slate-400">Not set</span>] as [string, React.ReactNode]),
            ]} />
          </div>
        )}
        <CheckList checks={byCat(r, "security")} grouped={false} />
      </Section>
    </div>
  );
}

function ContentTab({ r }: { r: AuditRecord }) {
  return (
    <div className="space-y-6">
      {r.keyword && (
        <Card>
          <CardHeader><CardTitle>On-page keyword analysis: “{r.keyword.primary}”</CardTitle><CardDescription>Whole-phrase, case-insensitive matching on the start page. Density ~{r.keyword.density}% (shown for awareness; there is no ideal value). No search volume or ranking data is used.</CardDescription></CardHeader>
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
              {r.keyword.unavailable.map((u) => <div key={u} className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500"><span className="block font-medium text-slate-700">{u}</span>Unavailable. Connect a keyword data provider.</div>)}
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
      <Section title="AEO Readiness Assessment" score={r.scores.categories.aeo.score} description="How clearly the page answers likely questions, based on its structure and content. This does not show whether any answer engine uses the page.">
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
        <p>This is an assessment of signals that help AI systems understand and cite a site. A technical crawl cannot show whether ChatGPT, Gemini, Perplexity or other AI systems actually mention or cite this brand, so no AI visibility percentages or citation counts are shown.</p>
      </div>
      <Section title="GEO Readiness Assessment" score={r.scores.categories.geo.score}><CheckList checks={byCat(r, "geo")} /></Section>
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
  const catRow = (label: string, v: number | null | undefined) => [label, fmt(v ?? null)] as [string, React.ReactNode];
  return (
    <div className="space-y-6">
      <RetryPerformanceButton r={r} />
      {r.performance.length === 0 && <p className="text-sm text-slate-500">Performance was not tested for this audit (turned off when the audit was started).</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        {r.performance.map((p) => (
          <Card key={p.strategy}>
            <CardHeader className="flex-row items-center justify-between"><CardTitle>{p.strategy === "mobile" ? "Mobile" : "Desktop"} performance</CardTitle><span className={cn("rounded-lg px-3 py-1 text-sm font-semibold", scoreTone(p.score).bg, scoreTone(p.score).text)}>{p.status === "ok" ? `${p.score}/100` : "Not tested"}</span></CardHeader>
            <CardContent>
              {p.status !== "ok" ? (
                <p className="text-sm text-slate-500">{p.error}{p.quota && " Add a free PAGESPEED_API_KEY on the server or retry later."}</p>
              ) : (
                <>
                  <p className="mb-1 text-xs text-slate-500">Tested {p.fetchedAt ? formatDate(p.fetchedAt) : "—"}{p.cached ? " (cached result)" : ""}</p>
                  {p.categories && (
                    <>
                      <p className="mt-2 mb-1 text-xs font-semibold uppercase text-slate-500">Lighthouse categories</p>
                      <KV rows={[catRow("Performance", p.categories.performance), catRow("Accessibility", p.categories.accessibility), catRow("Best Practices", p.categories.bestPractices), catRow("SEO", p.categories.seo)]} />
                    </>
                  )}
                  <p className="mt-4 mb-1 text-xs font-semibold uppercase text-slate-500">Lab data (Lighthouse {p.lighthouseVersion})</p>
                  <KV rows={Object.entries(p.lab).map(([k, v]) => [k, v.display ?? "Unavailable"])} />
                  <p className="mt-4 mb-1 text-xs font-semibold uppercase text-slate-500">Field data (Chrome UX Report, p75)</p>
                  {p.field.source === "none" ? <p className="text-sm text-slate-500">No field data available: there is not enough real-user data for this URL or origin. INP is only available as field data and is not estimated from lab metrics.</p> : (
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
  const sw = SEVERITY_WEIGHTS;
  const seoW = Object.entries(SEO_COMPONENT_WEIGHTS).map(([k, v]) => `${CATEGORY_LABELS[k as Category]} ${v}%`).join(", ");
  const ovW = Object.entries(OVERALL_WEIGHTS).map(([k, v]) => `${k} ${v}%`).join(", ");
  const tasks = r.tasks || [];
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>How the scores are calculated</CardTitle><CardDescription>Methodology version {s.methodologyVersion}. This is {APP_NAME}&apos;s diagnostic model, not an official Google, ChatGPT or other search engine score.</CardDescription></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-700">{s.overall.formula}</p>
          <p>Each check is worth points by severity (critical {sw.critical}, high {sw.high}, medium {sw.medium}, low {sw.low}). A pass earns full points, a warning half and a failure none. Not applicable, informational and skipped checks are excluded, so missing data never counts as a pass or a failure. Every check belongs to exactly one category, so the same issue is not penalised twice. Performance uses the Lighthouse score directly.</p>
          <p>SEO score: {seoW}. Overall health: {ovW}. Weights are renormalised over the parts that were actually tested.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Overall component</th><th>Score</th><th>Weight</th><th>Effective</th><th>Contribution</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{s.overall.components.map((c) => <tr key={c.name}><td className="py-2">{c.name}</td><td>{fmt(c.score)}</td><td>{c.weight}%</td><td>{c.effectiveWeight}%</td><td>{c.contribution ?? "—"}</td></tr>)}
                <tr className="font-semibold"><td className="py-2">Overall</td><td>{fmt(s.overall.score)}</td><td /><td /><td /></tr></tbody></table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Category</th><th>Score</th><th>Points</th><th>Pass</th><th>Warn</th><th>Fail</th><th>Not tested</th><th>N/A</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{Object.values(s.categories).map((c) => <tr key={c.category}><td className="py-2">{c.label}</td><td>{fmt(c.score)}</td><td>{c.category === "performance" ? "Lighthouse" : `${c.earned}/${c.possible}`}</td><td>{c.counts.pass}</td><td>{c.counts.warning}</td><td>{c.counts.fail}</td><td>{c.counts.not_tested}</td><td>{c.counts.not_applicable ?? 0}</td></tr>)}</tbody></table>
          </div>
          <p className="text-xs text-slate-500">Each finding is labelled with its source: <strong>Observed</strong> (measured directly from fetched pages or headers), <strong>External</strong> (returned by a Google API) or <strong>Assessment</strong> (this tool&apos;s judgement from page signals).</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Audit configuration and run details</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <KV rows={[
            ["Mode", r.input.mode === "full" ? `Full Site Audit (max ${r.input.maxPages} pages, depth ${r.input.maxDepth})` : "Quick Audit (single page)"],
            ["Primary keyword", r.input.primaryKeyword || "None"],
            ["Secondary keywords", (r.input.secondaryKeywords ?? []).join(", ") || "None"],
            ["Competitors", (r.input.competitorUrls ?? []).join(", ") || "None"],
            ["Business", [r.input.businessName, r.input.businessLocation, r.input.businessType].filter(Boolean).join(" · ") || "Not provided"],
            ["Performance", r.input.runPerformance ? `PageSpeed Insights (${r.input.performanceStrategy})` : "Off"],
            ["Rendering", r.input.renderJs ? "Headless Chromium requested" : "Off"],
            ["robots.txt", r.input.respectRobots ? "Respected" : "Not respected (owner override)"],
            ["Search Console", r.input.useSearchConsole ? "Requested" : "Not used"],
          ]} />
          {tasks.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">External tasks</p>
              <ul className="space-y-1">{tasks.map((x) => <li key={x.id}><span className="font-medium">{x.label}</span>: {x.status}{x.detail ? ` · ${x.detail}` : ""}</li>)}</ul>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Limitations and unavailable data</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="list-disc space-y-1 pl-5">{r.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          <KV rows={[["PageSpeed Insights", r.integrations.pagespeed], ["Google Search Console", r.integrations.searchConsole], ["Browser rendering", r.integrations.rendering], ["AI provider", r.integrations.ai], ["Keyword data", r.integrations.keywordData], ...(r.integrations.aiVisibility ? [["AI visibility", r.integrations.aiVisibility] as [string, string]] : [])]} />
        </CardContent>
      </Card>
    </div>
  );
}
