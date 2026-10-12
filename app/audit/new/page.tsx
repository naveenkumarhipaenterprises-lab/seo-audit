import { AuditForm } from "@/components/audit-form";
import { renderingConfigured } from "@/lib/audit/render";

export const dynamic = "force-dynamic";
export const metadata = { title: "New audit" };

export default function NewAudit() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">New audit</h1>
        <p className="mt-1 text-slate-500">Audits one public page: metadata, headings, indexability, links, images, keywords, AEO, GEO, mobile and performance.</p>
      </div>
      <AuditForm renderingAvailable={renderingConfigured()} />
    </div>
  );
}
