/**
 * Structured server-side logging (one JSON line per event). Never pass credentials,
 * cookies, API keys or full request headers in `data`.
 */
export function log(level: "info" | "warn" | "error", event: string, data: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
