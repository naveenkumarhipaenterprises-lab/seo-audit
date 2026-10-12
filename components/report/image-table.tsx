"use client";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { ImageRecord } from "@/lib/audit/types";
import { cn, safeHref } from "@/lib/utils";

const FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "missing", label: "Missing ALT", test: (i: ImageRecord) => i.altState === "missing" },
  { key: "empty", label: "Empty ALT", test: (i: ImageRecord) => i.altState === "empty" },
  { key: "issues", label: "With issues", test: (i: ImageRecord) => imageIssues(i).length > 0 },
  { key: "broken", label: "Broken", test: (i: ImageRecord) => isBroken(i) },
  { key: "large", label: "Over 500 KB", test: (i: ImageRecord) => (i.probe?.bytes ?? 0) > 500 * 1024 },
  { key: "nodims", label: "No dimensions", test: (i: ImageRecord) => !i.widthAttr || !i.heightAttr },
] as const;

const isBroken = (i: ImageRecord) => Boolean(i.probe && ((i.probe.error && !i.probe.unverified) || (i.probe.status ?? 0) >= 400));

/** Issues and fixes derived only from what was observed for this image (attributes and, when probed, the HTTP response). */
export function imageIssues(i: ImageRecord): { issue: string; fix: string }[] {
  const out: { issue: string; fix: string }[] = [];
  if (isBroken(i)) out.push({ issue: `Broken (${i.probe?.status ?? i.probe?.error ?? "error"})`, fix: "Fix the image URL or remove the reference." });
  if (i.altState === "missing") out.push({ issue: "Missing ALT attribute", fix: i.decorativeHint ? "Add alt=\"\" if the image is decorative." : "Add ALT text describing the image's content or purpose." });
  if (i.altState === "present" && (i.alt || "").length > 125) out.push({ issue: "Long ALT text", fix: "Shorten the ALT text to a concise description." });
  if ((i.probe?.bytes ?? 0) > 500 * 1024) out.push({ issue: `Large file (${Math.round((i.probe?.bytes ?? 0) / 1024)} KB)`, fix: "Compress the image or serve a modern format (WebP/AVIF) at the displayed size." });
  if (!i.widthAttr || !i.heightAttr) out.push({ issue: "No width/height attributes", fix: "Set width and height (or aspect-ratio) to prevent layout shift." });
  if (i.probe?.format && /^(png|jpe?g|gif|bmp)$/i.test(i.probe.format) && (i.probe.bytes ?? 0) > 100 * 1024) out.push({ issue: `Legacy format (${i.probe.format})`, fix: "Consider WebP or AVIF." });
  return out;
}

export function ImageTable({ images }: { images: ImageRecord[] }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<(typeof FILTERS)[number]["key"]>("all");
  const rows = useMemo(() => {
    const flt = FILTERS.find((x) => x.key === f)!;
    const needle = q.toLowerCase();
    return images.filter((i) => flt.test(i) && (!needle || i.src.toLowerCase().includes(needle) || i.sourcePage.toLowerCase().includes(needle) || (i.alt || "").toLowerCase().includes(needle)));
  }, [images, q, f]);
  if (!images.length) return <p className="text-sm text-slate-500">No images were found in the analysed HTML.</p>;
  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search image, page URL or ALT text" aria-label="Search images"
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
        <table className="w-full min-w-[1000px] text-left text-sm">
          <caption className="sr-only">Images found, with observed issues and suggested fixes</caption>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">Image URL</th><th className="px-3 py-2">Page</th><th className="px-3 py-2">ALT</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Format</th><th className="px-3 py-2">Size</th><th className="px-3 py-2">Dimensions</th><th className="px-3 py-2">Loading</th><th className="px-3 py-2">Issue and suggested fix</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((i) => {
              const href = safeHref(i.src);
              const broken = isBroken(i);
              const page = safeHref(i.sourcePage);
              const issues = imageIssues(i);
              return (
                <tr key={`${i.sourcePage}|${i.src}`} className="align-top">
                  <td className="max-w-xs px-3 py-2">
                    {href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-start gap-1 break-all text-brand-700 hover:underline">{i.src}<ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-label="opens in new tab" /></a> : <span className="break-all">{i.src}</span>}
                  </td>
                  <td className="max-w-[12rem] px-3 py-2 text-xs">{page ? <a href={page} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-700 hover:underline">{i.sourcePage}</a> : <span className="break-all">{i.sourcePage}</span>}</td>
                  <td className="max-w-[14rem] px-3 py-2">
                    {i.altState === "missing" ? <span className="font-medium text-red-700">Missing</span> : i.altState === "empty" ? <span className="text-slate-500">Empty (decorative)</span> : <span className="break-words text-slate-700">{i.alt}</span>}
                  </td>
                  <td className="px-3 py-2">{!i.probe ? <span className="text-slate-400">Not checked</span> : i.probe.unverified ? <span className="text-slate-500" title={i.probe.error}>Unverified</span> : broken ? <span className="font-medium text-red-700">{i.probe.status ?? "Error"}</span> : <span className="text-green-700">{i.probe.status}</span>}</td>
                  <td className="px-3 py-2 text-slate-600">{i.probe?.format || i.probe?.contentType?.replace("image/", "") || "—"}</td>
                  <td className={cn("px-3 py-2", (i.probe?.bytes ?? 0) > 500 * 1024 ? "font-medium text-amber-700" : "text-slate-600")}>{i.probe?.bytes ? `${Math.round(i.probe.bytes / 1024)} KB` : "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{i.probe?.width ? `${i.probe.width}×${i.probe.height}` : "—"}{(!i.widthAttr || !i.heightAttr) && <span className="block text-xs text-amber-700">no width/height attr</span>}</td>
                  <td className="px-3 py-2 text-slate-600">{i.loading || "—"}</td>
                  <td className="max-w-[18rem] px-3 py-2 text-xs">{issues.length === 0 ? <span className="text-slate-400">No issue observed</span> : <ul className="space-y-1">{issues.map((x) => <li key={x.issue}><span className="font-medium text-slate-800">{x.issue}.</span> <span className="text-slate-600">{x.fix}</span></li>)}</ul>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Image previews are not loaded into this app. Size, format and dimensions are shown only for images that were actually requested (&quot;Not checked&quot; otherwise).</p>
    </div>
  );
}
