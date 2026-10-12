import { NextResponse } from "next/server";
import { getJob, view } from "@/lib/audit/jobs";
import { ownerIdFromCookieHeader } from "@/lib/security/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^[0-9a-f-]{36}$/;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = ID_RE.test(id) ? getJob(id, ownerIdFromCookieHeader(req.headers.get("cookie"))) : null;
  if (!job) return NextResponse.json({ error: "This audit job is no longer available. Finished audits are listed in Audit History." }, { status: 404 });
  return NextResponse.json(view(job), { headers: { "cache-control": "no-store" } });
}
