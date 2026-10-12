"use client";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { ImageRecord } from "@/lib/audit/types";
import { cn, safeHref } from "@/lib/utils";

const FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "missing", label: "Missing ALT", test: (i: ImageRecord) => i.altState === "missing" },
  { key: "empty", label: "Empty ALT", test: (i: ImageRecord) => i.altState === "empty" },
  { key: "broken", label: "Broken", test: (i: ImageRecord) => Boolean(i.probe && ((i.probe.error && !i.probe.unverified) || (i.probe.status ?? 0) >= 400)) },
  { key: "large", label: "Over 500 KB", test: (i: ImageRecord) => (i.probe?.bytes ?? 0) > 500 * 1024 },
  { key: "nodims", label: "No dimensions", test: (i: ImageRecord) => !i.widthAttr || !i.heightAttr },
] as const;

export function ImageTable({ images }: { images: ImageRecord[] }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<(typeof FILTERS)[number]["key"]>("all");
  const rows = useMemo(() => {
    const flt = FILTERS.find((x) => x.key === f)!;
    const needle = q.toLowerCase();
    return images.filter((i) => flt.test(i) && (!needle || i.src.toLowerCase().includes(needle) || (i.alt || "").toLowerCase().includes(needle)));
  }, [images, q, f]);
  if (!images.length) return <p className="text-sm text-slate-500">No images were found in the page HTML.</p>;
  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search image URL or ALT text" aria-label="Search images"
          className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-500 sm:max-w-xs" />
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((x) => (
            <button key={x.key} onClick={() => setF(x.key)} aria-pressed={f === x.key}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium", f === x.key ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600")}>
              {x.label} ({images.filter(x.test).length})
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">Image URL</th><th className="px-3 py-2">ALT</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Format</th><th className="px-3 py-2">Size</th><th className="px-3 py-2">Dimensions</th><th className="px-3 py-2">Loading</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((i) => {
              const href = safeHref(i.src);
              const broken = i.probe && ((i.probe.error && !i.probe.unverified) || (i.probe.status ?? 0) >= 400);
              return (
                <tr key={i.src} className="align-top">
                  <td className="max-w-xs px-3 py-2">
                    {href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-start gap-1 break-all text-brand-700 hover:underline">{i.src}<ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-label="opens in new tab" /></a> : <span className="break-all">{i.src}</span>}
                  </td>
                  <td className="max-w-[14rem] px-3 py-2">
                    {i.altState === "missing" ? <span className="font-medium text-red-700">Missing</span> : i.altState === "empty" ? <span className="text-slate-500">Empty (decorative)</span> : <span className="break-words text-slate-700">{i.alt}</span>}
                  </td>
                  <td className="px-3 py-2">{!i.probe ? <span className="text-slate-400">Not checked</span> : i.probe.unverified ? <span className="text-slate-500" title={i.probe.error}>Unverified</span> : broken ? <span className="font-medium text-red-700">{i.probe.status ?? "Error"}</span> : <span className="text-green-700">{i.probe.status}</span>}</td>
                  <td className="px-3 py-2 text-slate-600">{i.probe?.format || i.probe?.contentType?.replace("image/", "") || "—"}</td>
                  <td className={cn("px-3 py-2", (i.probe?.bytes ?? 0) > 500 * 1024 ? "font-medium text-amber-700" : "text-slate-600")}>{i.probe?.bytes ? `${Math.round(i.probe.bytes / 1024)} KB` : "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{i.probe?.width ? `${i.probe.width}×${i.probe.height}` : "—"}{(!i.widthAttr || !i.heightAttr) && <span className="block text-xs text-amber-700">no width/height attr</span>}</td>
                  <td className="px-3 py-2 text-slate-600">{i.loading || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
