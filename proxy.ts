import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth } from "./lib/security/access";

/**
 * Optional access gate. When APP_PASSWORD is set every page and API route requires
 * HTTP Basic auth, so private audit reports are not publicly reachable on a deployed
 * MVP before Supabase Auth is introduced (Phase 2).
 */
export function proxy(req: NextRequest) {
  const result = checkBasicAuth(req.headers.get("authorization"), process.env.APP_PASSWORD, process.env.APP_USERNAME);
  if (result === "allowed") return NextResponse.next();
  return new NextResponse("Authentication required", { status: 401, headers: { "www-authenticate": 'Basic realm="SearchScope", charset="UTF-8"' } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
