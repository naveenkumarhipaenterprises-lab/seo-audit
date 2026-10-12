import { AuditForm } from "@/components/audit-form";
import { auditFormProps } from "@/lib/server-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "New audit" };

export default async function NewAudit({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const { url } = await searchParams;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">New audit</h1>
        <p className="mt-1 text-slate-500">Quick Audit checks one page. Full Site Audit also crawls internal pages within your limits. Every finding comes from requests made during the audit.</p>
      </div>
      <AuditForm {...await auditFormProps()} initialUrl={typeof url === "string" ? url.slice(0, 2048) : ""} />
    </div>
  );
}
