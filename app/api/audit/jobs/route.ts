import { NextResponse } from "next/server";
import { activeJobs, view } from "@/lib/audit/jobs";
import { ownerIdFromCookieHeader } from "@/lib/security/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Running (and just-finished) jobs for this browser, so the progress panel can resume after a reload. */
export async function GET(req: Request) {
  const owner = ownerIdFromCookieHeader(req.headers.get("cookie"));
  return NextResponse.json({ jobs: activeJobs(owner).map((j) => view(j)) }, { headers: { "cache-control": "no-store" } });
}
