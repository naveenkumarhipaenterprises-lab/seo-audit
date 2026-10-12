import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listAudits } from "@/lib/server-data";
import { formatDate, hostOf } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

export default async function Projects() {
  const audits = (await listAudits(200)).filter((a) => a.hasReport !== false);
  const sites = new Map<string, { count: number; latest: (typeof audits)[number] }>();
  for (const a of audits) {
    const h = hostOf(a.finalUrl);
    const cur = sites.get(h);
    sites.set(h, { count: (cur?.count || 0) + 1, latest: cur?.latest || a });
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Projects</h1>
        <p className="mt-1 text-slate-500">Audited websites are grouped here by domain. Named projects with team access need user accounts, which are not built yet.</p>
      </div>
      {sites.size === 0 ? <Card><CardContent><p className="text-sm text-slate-500">No websites audited yet.</p></CardContent></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from(sites.entries()).map(([host, s]) => (
            <Card key={host}>
              <CardHeader><CardTitle className="truncate">{host}</CardTitle></CardHeader>
              <CardContent className="text-sm text-slate-600">
                <p>{s.count} audit{s.count === 1 ? "" : "s"} · last {formatDate(s.latest.createdAt)}</p>
                <p className="mt-1">Latest overall score: <span className="font-semibold">{s.latest.overall ?? "Not tested"}</span></p>
                <Link href={`/audits/${s.latest.id}`} className="mt-3 inline-block font-medium text-brand-700 hover:underline">Open latest report</Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
