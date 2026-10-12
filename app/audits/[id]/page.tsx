import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getStore, isValidAuditId } from "@/lib/store";
import { previousAuditFor } from "@/lib/server-data";
import { ReportView } from "@/components/report/report-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit report" };

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidAuditId(id)) notFound();
  const record = await getStore().get(id);
  if (!record) notFound();
  const previous = await previousAuditFor(record.finalUrl, record.createdAt);
  return (
    <Suspense>
      <ReportView record={record} previous={previous} />
    </Suspense>
  );
}
