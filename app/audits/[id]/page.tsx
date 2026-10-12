import { notFound } from "next/navigation";
import { Suspense } from "react";
import { isValidAuditId } from "@/lib/store";
import { getAudit, previousAuditFor } from "@/lib/server-data";
import { compareAudits } from "@/lib/audit/compare";
import { ReportView } from "@/components/report/report-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit report" };

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidAuditId(id)) notFound();
  const record = await getAudit(id);
  if (!record) notFound();
  const previous = await previousAuditFor(record.finalUrl, record.createdAt);
  const comparison = previous ? compareAudits(record, previous) : null;
  return (
    <Suspense>
      <ReportView record={record} comparison={comparison} fixed={comparison ? comparison.resolvedIssues : null} />
    </Suspense>
  );
}
