import { NextResponse } from "next/server";
import { getStore, isValidAuditId } from "@/lib/store";
import { auditToPdf } from "@/lib/export/pdf";
import { reportFilename } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = isValidAuditId(id) ? await getStore().get(id) : null;
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
    console.error("pdf generation failed", (e as Error).message);
    return NextResponse.json({ error: "The PDF could not be generated. Please retry." }, { status: 500 });
  }
}
