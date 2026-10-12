import { HistoryTable } from "@/components/history-table";
import { Card, CardContent } from "@/components/ui/card";
import { listAudits } from "@/lib/server-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

export default async function Reports() {
  const audits = (await listAudits(100)).filter((a) => a.hasReport !== false);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <p className="mt-1 text-slate-500">Download PDF or CSV reports generated from each saved audit. Reports are private to this browser unless shared history is enabled in Settings.</p>
      </div>
      <Card><CardContent><HistoryTable audits={audits} mode="reports" /></CardContent></Card>
    </div>
  );
}
