/** Constant-time string comparison that works in Edge and Node runtimes. */
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Returns "allowed" when no password is configured or the Basic credentials match. */
export function checkBasicAuth(header: string | null, password: string | undefined, username = "admin"): "allowed" | "denied" {
  if (!password) return "allowed";
  if (!header?.startsWith("Basic ")) return "denied";
  let decoded = "";
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return "denied";
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return "denied";
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return safeEqual(user, username || "admin") && safeEqual(pass, password) ? "allowed" : "denied";
}
