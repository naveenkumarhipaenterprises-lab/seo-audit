import { NextResponse } from "next/server";
import { getStore, isValidAuditId } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidAuditId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await getStore().get(id);
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidAuditId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ok = await getStore().remove(id);
  return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
