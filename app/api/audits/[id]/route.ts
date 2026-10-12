import { NextResponse } from "next/server";
import { getStore, isValidAuditId } from "@/lib/store";
import { ownerIdFromCookieHeader } from "@/lib/security/owner";
import type { IssueState } from "@/lib/audit/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const owner = (req: Request) => ownerIdFromCookieHeader(req.headers.get("cookie"));
const STATES: IssueState[] = ["open", "ignored", "not_applicable"];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidAuditId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await getStore().get(id, owner(req));
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
}

/** Sets an issue's review state (Open / Ignored / Not applicable). Raw findings and scores are not changed. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidAuditId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: { checkId?: unknown; state?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const store = getStore();
  const r = await store.get(id, owner(req));
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (typeof body.checkId !== "string" || !r.checks.some((c) => c.id === body.checkId)) return NextResponse.json({ error: "Unknown check." }, { status: 400 });
  if (!STATES.includes(body.state as IssueState)) return NextResponse.json({ error: "Invalid state." }, { status: 400 });
  const issueStates = { ...(r.issueStates || {}) };
  if (body.state === "open") delete issueStates[body.checkId];
  else issueStates[body.checkId] = body.state as IssueState;
  await store.save({ ...r, issueStates });
  return NextResponse.json({ issueStates });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidAuditId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ok = await getStore().remove(id, owner(req));
  return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
