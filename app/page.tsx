import Link from "next/link";
import { AuditForm } from "@/components/audit-form";
import { HistoryTable } from "@/components/history-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getStore } from "@/lib/store";
import { renderingConfigured } from "@/lib/audit/render";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import { formatDate, scoreTone } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const audits = await getStore().list(6);
  const latest = audits[0];
  const latestRecord = latest ? await getStore().get(latest.id) : null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Welcome to {APP_NAME}</h1>
        <p className="mt-1 text-slate-500">{APP_TAGLINE} Run a real audit of any public page for SEO, AEO and GEO signals.</p>
      </div>
      <AuditForm renderingAvailable={renderingConfigured()} compact />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Recent audits</CardTitle><Link href="/history" className="text-sm font-medium text-brand-700 hover:underline">View all</Link></CardHeader>
          <CardContent><HistoryTable audits={audits} mode="compact" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Most recent audit</CardTitle></CardHeader>
          <CardContent>
            {!latestRecord ? <p className="text-sm text-slate-500">No completed audits yet.</p> : (
              <div className="space-y-3">
                <Link href={`/audits/${latestRecord.id}`} className="block break-all font-medium text-brand-700 hover:underline">{latestRecord.finalUrl}</Link>
                <p className="text-xs text-slate-500">{formatDate(latestRecord.completedAt)}{latestRecord.status === "partial" ? " · Partial" : ""}</p>
                <div className="grid grid-cols-2 gap-2">
                  {([["Overall", latestRecord.scores.overall.score], ["SEO", latestRecord.scores.seo.score], ["AEO", latestRecord.scores.categories.aeo.score], ["GEO", latestRecord.scores.categories.geo.score]] as const).map(([l, v]) => {
                    const t = scoreTone(v);
                    return <div key={l} className={`rounded-lg p-3 ${t.bg}`}><p className="text-xs text-slate-500">{l}</p><p className={`text-xl font-semibold ${t.text}`}>{v ?? "Not tested"}</p></div>;
                  })}
                </div>
                <p className="text-sm text-slate-600">{latestRecord.scores.totals.errors} errors · {latestRecord.scores.totals.warnings} warnings · {latestRecord.scores.totals.passed} passed</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
