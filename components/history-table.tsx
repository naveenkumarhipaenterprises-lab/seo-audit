"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, FileSpreadsheet, Trash2 } from "lucide-react";
import type { AuditSummary } from "@/lib/store";
import { cn, formatDate, scoreTone } from "@/lib/utils";
import { statusLabel } from "@/lib/audit/record-utils";

function Score({ v }: { v: number | null }) {
  const t = scoreTone(v);
  return <span className={cn("inline-flex min-w-10 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold", t.bg, t.text)}>{v ?? "—"}</span>;
}

export function HistoryTable({ audits, mode = "history" }: { audits: AuditSummary[]; mode?: "history" | "reports" | "compact" }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function remove(id: string) {
    if (!confirm("Delete this audit and its report permanently?")) return;
    setBusy(id);
    const res = await fetch(`/api/audits/${id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok || res.status === 404) router.refresh();
    else alert("Could not delete the audit.");
  }
  if (!audits.length) return <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No audits yet. Run your first audit to see it here.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="py-2 pr-3">Website</th><th className="pr-3">Date</th><th className="pr-3">Mode / status</th><th className="pr-3">Overall</th><th className="pr-3">SEO</th><th className="pr-3">AEO</th><th className="pr-3">GEO</th>{mode !== "compact" && <th className="pr-3">Issues</th>}<th className="text-right">Actions</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {audits.map((a) => (
            <tr key={a.id} className="align-middle">
              <td className="max-w-[16rem] py-2.5 pr-3">
                {a.hasReport === false ? <span className="block truncate font-medium text-slate-700">{a.finalUrl}</span> : <Link href={`/audits/${a.id}`} className="block truncate font-medium text-brand-700 hover:underline">{a.finalUrl}</Link>}
                {a.failure && <span className="block truncate text-xs text-slate-500" title={a.failure.message}>{a.failure.message}</span>}
              </td>
              <td className="pr-3 whitespace-nowrap text-slate-500">{formatDate(a.createdAt)}</td>
              <td className="pr-3 whitespace-nowrap text-xs">
                <span className="block text-slate-600">{a.mode === "full" ? `Full site${a.pagesAnalyzed ? ` · ${a.pagesAnalyzed} pages` : ""}` : "Quick"}</span>
                <span className={cn(a.status === "failed" ? "text-red-700" : a.status === "cancelled" ? "text-slate-500" : a.status === "partial" ? "text-amber-700" : a.status === "completed_with_warnings" ? "text-amber-700" : "text-green-700")}>{statusLabel(a.status)}</span>
              </td>
              <td className="pr-3"><Score v={a.overall} /></td><td className="pr-3"><Score v={a.seo} /></td><td className="pr-3"><Score v={a.aeo} /></td><td className="pr-3"><Score v={a.geo} /></td>
              {mode !== "compact" && <td className="pr-3 whitespace-nowrap text-slate-600"><span className="text-red-700">{a.errors} errors</span> · <span className="text-amber-700">{a.warnings} warnings</span></td>}
              <td className="text-right whitespace-nowrap">
                {a.hasReport === false ? (
                  mode === "history" ? <button onClick={() => remove(a.id)} disabled={busy === a.id} className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete record of ${a.finalUrl}`}><Trash2 className="h-4 w-4" /></button> : null
                ) : mode === "reports" ? (
                  <span className="inline-flex gap-1">
                    <a href={`/api/audits/${a.id}/pdf`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"><Download className="h-3 w-3" />PDF</a>
                    <a href={`/api/audits/${a.id}/csv`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"><FileSpreadsheet className="h-3 w-3" />CSV</a>
                  </span>
                ) : (
                  <span className="inline-flex gap-1">
                    <Link href={`/audits/${a.id}`} className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">View</Link>
                    {mode === "history" && <button onClick={() => remove(a.id)} disabled={busy === a.id} className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete audit of ${a.finalUrl}`}><Trash2 className="h-4 w-4" /></button>}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
