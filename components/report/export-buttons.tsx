"use client";
import { useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, Loader2, Printer, RotateCcw } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";

export function ExportButtons({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState("");
  async function downloadPdf() {
    setState("loading");
    try {
      const res = await fetch(`/api/audits/${id}/pdf`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || "searchscope-report.pdf";
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState("idle");
    } catch (e) {
      setErr((e as Error).message);
      setState("error");
    }
  }
  return (
    <div className="no-print flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        <Button onClick={downloadPdf} disabled={state === "loading"} data-testid="download-pdf">
          {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          {state === "loading" ? "Generating PDF…" : "Download PDF Report"}
        </Button>
        <a href={`/api/audits/${id}/csv`} className={buttonClass("secondary")} data-testid="export-csv"><FileSpreadsheet className="h-4 w-4" aria-hidden /> Export CSV</a>
        <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print</Button>
      </div>
      {state === "error" && (
        <p className="flex items-center gap-2 text-sm text-red-700" role="alert">
          <AlertTriangle className="h-4 w-4" aria-hidden /> PDF failed: {err}
          <button onClick={downloadPdf} className="inline-flex items-center gap-1 font-medium underline"><RotateCcw className="h-3 w-3" aria-hidden />Retry</button>
        </p>
      )}
    </div>
  );
}
