import { NextResponse } from "next/server";
import { getStore, isValidAuditId } from "@/lib/store";
import { auditToCsv } from "@/lib/export/csv";
import { reportFilename } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = isValidAuditId(id) ? await getStore().get(id) : null;
  if (!r) return NextResponse.json({ error: "Audit not found" }, { status: 404 });
  return new Response(auditToCsv(r), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${reportFilename(r, "csv")}"`,
      "cache-control": "no-store",
    },
  });
}
