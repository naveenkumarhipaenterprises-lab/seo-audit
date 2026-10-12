import { NextResponse } from "next/server";
import { integrationStatus } from "@/lib/audit/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(integrationStatus());
}
