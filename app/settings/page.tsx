import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { integrationStatus } from "@/lib/audit/deps";
import { APP_NAME } from "@/lib/config";
import { METHODOLOGY_VERSION, OVERALL_WEIGHTS, SEO_COMPONENT_WEIGHTS, SEVERITY_WEIGHTS } from "@/lib/scoring/weights";
import { CATEGORY_LABELS, type Category } from "@/lib/audit/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const ROWS = (s: ReturnType<typeof integrationStatus>) => [
  { name: "Google PageSpeed Insights", state: s.pagespeed === "configured" ? "Configured" : "Keyless (shared quota)", ok: true, help: "Optional PAGESPEED_API_KEY (free from Google Cloud) gives reliable quota. Without it, requests use Google's shared keyless quota and may be rate limited." },
  { name: "Browser rendering (Chromium)", state: s.rendering === "configured" ? "Configured" : "Not configured", ok: s.rendering === "configured", help: "Set CHROMIUM_PATH or ENABLE_BROWSER_RENDERING=1 where a Chromium binary is available. Needed for rendered and responsive checks." },
  { name: "Google Search Console", state: "Not connected", ok: false, help: "Phase 2: OAuth connection and URL Inspection API for verified indexing status." },
  { name: "Supabase (database & auth)", state: s.supabase === "configured_unused" ? "Credentials present (adapter in Phase 2)" : "Not configured", ok: false, help: "Phase 2. The schema is in supabase/migrations. Audits are stored on the server's file system for now." },
  { name: "AI provider", state: "Not configured", ok: false, help: "Phase 3: optional server-side adapter. The audit never depends on it." },
  { name: "Keyword data provider", state: "Not connected", ok: false, help: "Search volume, difficulty and rankings stay 'Unavailable' until a provider is connected." },
  { name: "Access password", state: s.accessGate === "enabled" ? "Enabled" : "Disabled", ok: s.accessGate === "enabled", help: "Set APP_PASSWORD (and optionally APP_USERNAME) to require login before deploying publicly." },
];

export default function Settings() {
  const s = integrationStatus();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-slate-500">{APP_NAME} configuration. Secrets are read from server environment variables and never shown here.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Integrations</CardTitle></CardHeader>
        <CardContent className="divide-y divide-slate-100">
          {ROWS(s).map((r) => (
            <div key={r.name} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div><p className="font-medium text-slate-800">{r.name}</p><p className="text-sm text-slate-500">{r.help}</p></div>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${r.ok ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}`}>{r.state}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Scoring weights</CardTitle><CardDescription>Methodology {METHODOLOGY_VERSION}. Edit lib/scoring/weights.ts to change them; the version is stored with each audit.</CardDescription></CardHeader>
        <CardContent className="grid gap-6 text-sm sm:grid-cols-3">
          <div><p className="mb-2 font-medium">Overall</p>{Object.entries(OVERALL_WEIGHTS).map(([k, v]) => <p key={k} className="flex justify-between"><span>{k}</span><span>{v}%</span></p>)}</div>
          <div><p className="mb-2 font-medium">SEO components</p>{Object.entries(SEO_COMPONENT_WEIGHTS).map(([k, v]) => <p key={k} className="flex justify-between gap-2"><span>{CATEGORY_LABELS[k as Category]}</span><span>{v}</span></p>)}</div>
          <div><p className="mb-2 font-medium">Points per check</p>{Object.entries(SEVERITY_WEIGHTS).map(([k, v]) => <p key={k} className="flex justify-between capitalize"><span>{k}</span><span>{v}</span></p>)}</div>
        </CardContent>
      </Card>
    </div>
  );
}
