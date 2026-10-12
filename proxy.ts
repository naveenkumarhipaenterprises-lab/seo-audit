import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth } from "./lib/security/access";
import { OWNER_COOKIE, isValidOwnerToken } from "./lib/security/owner";

/**
 * 1. Optional access gate: when APP_PASSWORD is set every page and API route requires
 *    HTTP Basic auth.
 * 2. Owner cookie: every browser gets a random HttpOnly id so its audits, history and
 *    exports are private to it (see lib/security/owner.ts).
 */
export function proxy(req: NextRequest) {
  const result = checkBasicAuth(req.headers.get("authorization"), process.env.APP_PASSWORD, process.env.APP_USERNAME);
  if (result !== "allowed") {
    return new NextResponse("Authentication required", { status: 401, headers: { "www-authenticate": 'Basic realm="SearchScope", charset="UTF-8"' } });
  }
  if (isValidOwnerToken(req.cookies.get(OWNER_COOKIE)?.value)) return NextResponse.next();
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  // Make the new cookie visible to this same request's server components and routes.
  req.cookies.set(OWNER_COOKIE, token);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(OWNER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
