"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Globe2, Loader2, Search, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAuditJobs } from "@/components/audit-jobs";
import { cn } from "@/lib/utils";

const splitList = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
const MAX_PAGES = 100;
const MAX_DEPTH = 5;
const MAX_COMPETITORS = 3;

/** Client-side check mirroring the server rules, for instant feedback only. The server re-validates everything. */
export function quickValidate(u: string, label = "website URL"): string | null {
  const raw = u.trim();
  if (!raw) return `Enter a ${label}.`;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol)) return "Only http and https URLs are supported.";
    if (!url.hostname.includes(".")) return "Use a fully qualified public domain name.";
    if (url.username || url.password) return "URLs with embedded credentials are not allowed.";
  } catch {
    return "That does not look like a valid URL.";
  }
  return null;
}

type Errors = Partial<Record<"url" | "maxPages" | "maxDepth" | "competitors" | "secondary", string>>;

export interface GscState {
  configured: boolean;
  connected: boolean;
}

const input = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400";
const label = "mb-1.5 block text-sm font-medium text-slate-800";
const hint = "font-normal text-slate-400";

export function AuditForm({ renderingAvailable, gsc, compact = false, initialUrl = "" }: { renderingAvailable: boolean; gsc: GscState; compact?: boolean; initialUrl?: string }) {
  const { start, starting, job, error: startError } = useAuditJobs();
  const [url, setUrl] = useState(initialUrl);
  const [mode, setMode] = useState<"quick" | "full">("quick");
  const [maxPages, setMaxPages] = useState("25");
  const [maxDepth, setMaxDepth] = useState("2");
  const [keyword, setKeyword] = useState("");
  const [secondary, setSecondary] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessLocation, setBusinessLocation] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [advanced, setAdvanced] = useState(!compact);
  const [respectRobots, setRespectRobots] = useState(true);
  const [renderJs, setRenderJs] = useState(renderingAvailable);
  const [runPerformance, setRunPerformance] = useState(true);
  const [strategy, setStrategy] = useState<"both" | "mobile" | "desktop">("both");
  const [useGsc, setUseGsc] = useState(gsc.connected);
  const [checkExternal, setCheckExternal] = useState(false);
  const [linksToCheck, setLinksToCheck] = useState(20);
  const [errors, setErrors] = useState<Errors>({});

  function validate(): Errors {
    const e: Errors = {};
    const u = quickValidate(url);
    if (u) e.url = u;
    if (mode === "full") {
      const mp = Number(maxPages);
      if (!Number.isInteger(mp) || mp < 2 || mp > MAX_PAGES) e.maxPages = `Enter a whole number from 2 to ${MAX_PAGES}.`;
      const md = Number(maxDepth);
      if (!Number.isInteger(md) || md < 1 || md > MAX_DEPTH) e.maxDepth = `Enter a whole number from 1 to ${MAX_DEPTH}.`;
    }
    const comps = splitList(competitors);
    if (comps.length > MAX_COMPETITORS) e.competitors = `Add at most ${MAX_COMPETITORS} competitor URLs.`;
    else for (const c of comps) {
      const m = quickValidate(c, "competitor URL");
      if (m) {
        e.competitors = `${c}: ${m}`;
        break;
      }
    }
    if (splitList(secondary).length > 10) e.secondary = "Use at most 10 secondary keywords.";
    return e;
  }

  async function submit(ev?: React.FormEvent) {
    ev?.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      if (e.maxPages || e.maxDepth || e.competitors || e.secondary) setAdvanced(true);
      return;
    }
    await start({
      url, mode, maxPages: Number(maxPages) || 25, maxDepth: Number(maxDepth) || 2,
      primaryKeyword: keyword, secondaryKeywords: splitList(secondary), competitorUrls: splitList(competitors),
      businessName, businessLocation, businessType,
      respectRobots, renderJs: renderJs && renderingAvailable, runPerformance, performanceStrategy: strategy,
      useSearchConsole: useGsc && gsc.connected, linksToCheck, checkExternalLinks: checkExternal,
    });
  }

  const busy = starting || job?.status === "running";
  const err = (k: keyof Errors) => errors[k] && <p id={`${k}-error`} className="mt-1.5 text-sm text-red-600">{errors[k]}</p>;
  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={submit} noValidate className="space-y-5" aria-label="Start an audit">
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <div>
            <label htmlFor="url" className={label}>Website URL <span className="text-red-600" aria-hidden>*</span></label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input id="url" name="url" inputMode="url" autoComplete="url" required placeholder="https://www.example.com/page" value={url}
                onChange={(e) => setUrl(e.target.value)} aria-invalid={Boolean(errors.url)} aria-describedby={errors.url ? "url-error" : undefined}
                className={cn("h-11 w-full rounded-lg border bg-white pl-9 pr-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100", errors.url ? "border-red-400" : "border-slate-300")} />
            </div>
            {err("url")}
          </div>
          <div>
            <label htmlFor="kw" className={label}>Primary keyword <span className={hint}>(optional)</span></label>
            <input id="kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={100} placeholder="e.g. organic spices" className={cn(input, "h-11")} />
          </div>
        </div>

        <fieldset>
          <legend className={label}>Audit mode</legend>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
            {([
              ["quick", "Quick Audit", "The submitted page: SEO, AEO, GEO, images, metadata, accessibility, security headers and performance.", "Often about 15–90 s, depending on the site and external services.", Zap],
              ["full", "Full Site Audit", "Crawls internal pages up to your limits and adds site-wide findings: duplicates, broken links, orphans, inventory.", "Often 1–5 min for a small site; larger crawls take longer.", Globe2],
            ] as const).map(([k, title, desc, est, Icon]) => (
              <label key={k} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 transition focus-within:ring-2 focus-within:ring-brand-100", mode === k ? "border-brand-500 bg-brand-50/60" : "border-slate-200 bg-white hover:bg-slate-50")}>
                <input type="radio" name="mode" value={k} checked={mode === k} onChange={() => setMode(k)} className="mt-1 accent-brand-600" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Icon className="h-4 w-4 text-brand-600" aria-hidden />{title}</span>
                  <span className="mt-0.5 block text-xs text-slate-600">{desc}</span>
                  <span className="mt-1 block text-xs text-slate-400">{est} Not a guarantee; actual elapsed time is shown.</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === "full" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="maxPages" className={label}>Maximum pages to crawl <span className={hint}>(2–{MAX_PAGES})</span></label>
              <input id="maxPages" type="number" inputMode="numeric" min={2} max={MAX_PAGES} value={maxPages} onChange={(e) => setMaxPages(e.target.value)} aria-invalid={Boolean(errors.maxPages)} aria-describedby={errors.maxPages ? "maxPages-error" : undefined} className={input} />
              {err("maxPages")}
            </div>
            <div>
              <label htmlFor="maxDepth" className={label}>Crawl depth <span className={hint}>(links from the start page, 1–{MAX_DEPTH})</span></label>
              <input id="maxDepth" type="number" inputMode="numeric" min={1} max={MAX_DEPTH} value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} aria-invalid={Boolean(errors.maxDepth)} aria-describedby={errors.maxDepth ? "maxDepth-error" : undefined} className={input} />
              {err("maxDepth")}
            </div>
          </div>
        )}

        <button type="button" onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1 rounded text-sm font-medium text-brand-700 hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600" aria-expanded={advanced} aria-controls="advanced-settings">
          <ChevronDown className={cn("h-4 w-4 transition-transform", advanced && "rotate-180")} aria-hidden /> Keywords, competitors, business details and crawl settings
        </button>

        {advanced && (
          <div id="advanced-settings" className="grid gap-6 rounded-lg border border-slate-200 bg-slate-50/60 p-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label htmlFor="sec" className={label}>Secondary keywords</label>
                <textarea id="sec" rows={2} value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder="Comma or line separated (max 10)" aria-describedby={errors.secondary ? "secondary-error" : undefined}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
                {err("secondary")}
              </div>
              <div>
                <label htmlFor="comp" className={label}>Competitor URLs <span className={hint}>(up to {MAX_COMPETITORS}; one page each)</span></label>
                <textarea id="comp" rows={2} value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="One per line" aria-invalid={Boolean(errors.competitors)} aria-describedby={errors.competitors ? "competitors-error" : undefined}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
                {err("competitors")}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div><label htmlFor="bn" className={label}>Business name</label><input id="bn" value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={120} className={input} /></div>
                <div><label htmlFor="bl" className={label}>Location</label><input id="bl" value={businessLocation} onChange={(e) => setBusinessLocation(e.target.value)} maxLength={120} placeholder="City, region" className={input} /></div>
                <div><label htmlFor="bt" className={label}>Business type</label><input id="bt" value={businessType} onChange={(e) => setBusinessType(e.target.value)} maxLength={120} placeholder="e.g. restaurant" className={input} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="strategy" className={label}>Performance test</label>
                  <select id="strategy" value={strategy} onChange={(e) => setStrategy(e.target.value as typeof strategy)} disabled={!runPerformance} className={input}>
                    <option value="both">Mobile and desktop</option><option value="mobile">Mobile only</option><option value="desktop">Desktop only</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="links" className={label}>Start-page links to check</label>
                  <input id="links" type="number" min={0} max={50} value={linksToCheck} onChange={(e) => setLinksToCheck(Math.max(0, Math.min(50, Number(e.target.value) || 0)))} className={input} />
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <Switch id="perf" label="Run PageSpeed Insights" description="Google Lighthouse lab test plus real-user field data when Google has it. Usually the slowest step." checked={runPerformance} onChange={setRunPerformance} />
              <Switch id="render" label="Enable JavaScript rendering" description={renderingAvailable ? "Headless Chromium at mobile, tablet and desktop widths." : "Not configured on this server."} checked={renderJs && renderingAvailable} onChange={setRenderJs} disabled={!renderingAvailable} />
              <Switch id="robots" label="Respect robots.txt" description="Stop, and skip disallowed pages, if the site disallows our crawler." checked={respectRobots} onChange={setRespectRobots} />
              <Switch id="ext" label="Check external links" description="Up to 10 outbound links on the start page." checked={checkExternal} onChange={setCheckExternal} />
              <div>
                <Switch id="gsc" label="Use Google Search Console" checked={useGsc && gsc.connected} onChange={setUseGsc} disabled={!gsc.connected}
                  description={!gsc.configured ? "Not configured on this server." : gsc.connected ? "Adds clicks, impressions and URL Inspection for a verified property." : "Connect a Google account first."} />
                {gsc.configured && !gsc.connected && <Link href="/settings#search-console" className="ml-12 text-xs font-medium text-brand-700 hover:underline">Connect in Settings</Link>}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
            {job?.status === "running" ? "Audit running…" : mode === "full" ? "Start Full Site Audit" : "Start Quick Audit"}
          </Button>
          <p className="text-xs text-slate-500">Only public http/https sites. Private, local and internal addresses are blocked.</p>
        </div>
        {startError && !job && (
          <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{startError}</p>
        )}
      </form>
    </Card>
  );
}
