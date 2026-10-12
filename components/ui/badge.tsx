import { cn } from "@/lib/utils";
import type { CheckStatus, FindingSource, Severity } from "@/lib/audit/types";
import { SOURCE_LABELS } from "@/lib/audit/types";

const STATUS: Record<CheckStatus, [string, string]> = {
  pass: ["Pass", "bg-green-50 text-green-700 ring-green-600/20"],
  warning: ["Warning", "bg-amber-50 text-amber-800 ring-amber-600/25"],
  fail: ["Fail", "bg-red-50 text-red-700 ring-red-600/20"],
  info: ["Info", "bg-brand-50 text-brand-700 ring-brand-600/20"],
  not_applicable: ["N/A", "bg-slate-50 text-slate-500 ring-slate-400/20"],
  not_tested: ["Not tested", "bg-slate-100 text-slate-600 ring-slate-400/25"],
};
const SEV: Record<Severity, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-800",
  low: "bg-slate-100 text-slate-600",
};

export function StatusBadge({ status }: { status: CheckStatus }) {
  const [label, cls] = STATUS[status];
  return <span className={cn("inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", cls)}>{label}</span>;
}
export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize", SEV[severity])}>{severity}</span>;
}
export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600", className)}>{children}</span>;
}

const SRC: Record<FindingSource, string> = {
  observed: "border-slate-200 text-slate-600",
  external: "border-sky-200 text-sky-700",
  assessment: "border-violet-200 text-violet-700",
};
/** Provenance: observed fact, externally retrieved metric, or this tool's assessment. */
export function SourceBadge({ source }: { source: FindingSource }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-md border bg-white px-1.5 py-0.5 text-[11px] font-medium", SRC[source])} title="Where this finding comes from">{SOURCE_LABELS[source]}</span>;
}
