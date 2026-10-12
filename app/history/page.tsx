import { HistoryTable } from "@/components/history-table";
import { Card, CardContent } from "@/components/ui/card";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit history" };

export default async function History() {
  const audits = await getStore().list(100);
  const days = Number(process.env.AUDIT_RETENTION_DAYS ?? 30);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Audit history</h1>
        <p className="mt-1 text-slate-500">Saved audits on this server.{days > 0 ? ` Audits older than ${days} days are deleted automatically.` : ""}</p>
      </div>
      <Card><CardContent><HistoryTable audits={audits} /></CardContent></Card>
    </div>
  );
}
