import { NextResponse } from "next/server";
import { getStore, isValidAuditId } from "@/lib/store";
import { log } from "@/lib/log";
import { ownerIdFromCookieHeader } from "@/lib/security/owner";
import { auditToPdf } from "@/lib/export/pdf";
import { reportFilename } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = isValidAuditId(id) ? await getStore().get(id, ownerIdFromCookieHeader(req.headers.get("cookie"))) : null;
  if (!r) return NextResponse.json({ error: "Audit not found" }, { status: 404 });
  try {
    const pdf = await auditToPdf(r);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${reportFilename(r, "pdf")}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    log("error", "pdf.failed", { id, message: (e as Error).message });
    return NextResponse.json({ error: "The PDF could not be generated. Please retry." }, { status: 500 });
  }
}
