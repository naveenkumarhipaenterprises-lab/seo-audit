import { createHash } from "node:crypto";

/**
 * Per-browser ownership. proxy.ts gives every browser a random, HttpOnly owner cookie;
 * audits store only a hash of it, so a stored record never contains the bearer value.
 * Reports, history, exports and jobs are only visible to the browser that created them
 * unless AUDIT_SHARED_HISTORY=1 (e.g. a team deployment behind APP_PASSWORD).
 */
export const OWNER_COOKIE = "ss_owner";
const TOKEN_RE = /^[a-f0-9]{32,64}$/;

export function isValidOwnerToken(v: string | undefined | null): v is string {
  return Boolean(v && TOKEN_RE.test(v));
}

export function ownerIdFromToken(token: string | undefined | null): string | null {
  if (!isValidOwnerToken(token)) return null;
  return createHash("sha256").update(`searchscope-owner:${token}`).digest("hex").slice(0, 32);
}

/** Reads the owner id from a Cookie header (route handlers). */
export function ownerIdFromCookieHeader(header: string | null): string | null {
  const m = (header || "").match(new RegExp(`(?:^|;\\s*)${OWNER_COOKIE}=([^;]+)`));
  return ownerIdFromToken(m?.[1]);
}

export const sharedHistory = () => process.env.AUDIT_SHARED_HISTORY === "1";

/** Records without an owner were created before ownership existed and stay readable. */
export function canAccess(recordOwner: string | undefined | null, viewer: string | null): boolean {
  if (sharedHistory()) return true;
  if (!recordOwner) return true;
  return Boolean(viewer) && recordOwner === viewer;
}
