import { NextResponse } from "next/server";
import { cancelJob, getJob, view } from "@/lib/audit/jobs";
import { ownerIdFromCookieHeader } from "@/lib/security/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = ownerIdFromCookieHeader(req.headers.get("cookie"));
  const job = /^[0-9a-f-]{36}$/.test(id) ? getJob(id, owner) : null;
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  cancelJob(id, owner);
  return NextResponse.json(view(job), { status: 202 });
}
