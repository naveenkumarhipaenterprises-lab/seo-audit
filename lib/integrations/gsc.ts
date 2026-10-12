import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { request } from "undici";
import { apiDispatcher } from "../security/safe-fetch";
import type { SearchConsoleResult } from "../audit/types";

/**
 * Optional Google Search Console integration (OAuth 2.0, read-only scope).
 * Requires GSC_CLIENT_ID, GSC_CLIENT_SECRET, GSC_REDIRECT_URI and GSC_TOKEN_SECRET.
 * Refresh tokens are stored server-side, AES-256-GCM encrypted, per browser owner.
 */
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://searchconsole.googleapis.com";
const TIMEOUT = 20_000;

export function gscConfigured(): boolean {
  return Boolean(process.env.GSC_CLIENT_ID && process.env.GSC_CLIENT_SECRET && process.env.GSC_REDIRECT_URI && (process.env.GSC_TOKEN_SECRET || "").length >= 32);
}

export function authorizationUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GSC_CLIENT_ID!,
    redirect_uri: process.env.GSC_REDIRECT_URI!,
    response_type: "code",
    scope: GSC_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${p}`;
}

// ---------- token storage
interface StoredToken {
  refreshToken: string;
  connectedAt: string;
}
const tokenDir = () => process.env.GSC_TOKEN_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "gsc");
const key = () => createHash("sha256").update(process.env.GSC_TOKEN_SECRET || "").digest();
const OWNER_RE = /^[a-f0-9]{32}$/;

export function encrypt(plain: string, k = key()): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
export function decrypt(blob: string, k = key()): string {
  const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

async function saveToken(owner: string, t: StoredToken) {
  if (!OWNER_RE.test(owner)) throw new Error("Invalid owner");
  await fs.mkdir(tokenDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(/* turbopackIgnore: true */ tokenDir(), `${owner}.json`), encrypt(JSON.stringify(t)), { mode: 0o600 });
}
async function loadToken(owner: string | null): Promise<StoredToken | null> {
  if (!owner || !OWNER_RE.test(owner)) return null;
  try {
    return JSON.parse(decrypt(await fs.readFile(path.join(/* turbopackIgnore: true */ tokenDir(), `${owner}.json`), "utf8"))) as StoredToken;
  } catch {
    return null;
  }
}
export async function disconnect(owner: string | null) {
  if (!owner || !OWNER_RE.test(owner)) return;
  const t = await loadToken(owner);
  try {
    await fs.unlink(path.join(/* turbopackIgnore: true */ tokenDir(), `${owner}.json`));
  } catch {}
  if (t) {
    // Best-effort revocation at Google.
    try {
      await request(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refreshToken)}`, { method: "POST", dispatcher: apiDispatcher(), headersTimeout: TIMEOUT, bodyTimeout: TIMEOUT });
    } catch {}
  }
}
export async function connectionStatus(owner: string | null): Promise<{ configured: boolean; connected: boolean; connectedAt?: string }> {
  if (!gscConfigured()) return { configured: false, connected: false };
  const t = await loadToken(owner);
  return { configured: true, connected: Boolean(t), connectedAt: t?.connectedAt };
}

// ---------- HTTP helpers
async function postForm(url: string, form: Record<string, string>) {
  const res = await request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    dispatcher: apiDispatcher(),
    headersTimeout: TIMEOUT,
    bodyTimeout: TIMEOUT,
  });
  const json = (await res.body.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.statusCode, json };
}

async function api<T>(token: string, method: "GET" | "POST", url: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; json: T & { error?: { message?: string } } }> {
  const res = await request(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    dispatcher: apiDispatcher(),
    signal,
    headersTimeout: TIMEOUT,
    bodyTimeout: TIMEOUT,
  });
  const json = (await res.body.json().catch(() => ({}))) as T & { error?: { message?: string } };
  return { status: res.statusCode, json };
}

export async function exchangeCode(owner: string, code: string): Promise<void> {
  const r = await postForm(TOKEN_URL, {
    code,
    client_id: process.env.GSC_CLIENT_ID!,
    client_secret: process.env.GSC_CLIENT_SECRET!,
    redirect_uri: process.env.GSC_REDIRECT_URI!,
    grant_type: "authorization_code",
  });
  const refresh = r.json.refresh_token;
  if (r.status !== 200 || typeof refresh !== "string") throw new Error("Google did not return a refresh token.");
  await saveToken(owner, { refreshToken: refresh, connectedAt: new Date().toISOString() });
}

async function accessToken(owner: string | null): Promise<string | null> {
  const t = await loadToken(owner);
  if (!t) return null;
  const r = await postForm(TOKEN_URL, {
    refresh_token: t.refreshToken,
    client_id: process.env.GSC_CLIENT_ID!,
    client_secret: process.env.GSC_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  return r.status === 200 && typeof r.json.access_token === "string" ? r.json.access_token : null;
}

// ---------- property matching and data retrieval
export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

/** Picks the most specific verified property covering the URL (URL-prefix first, then domain property). */
export function matchProperty(url: string, sites: GscSite[]): GscSite | null {
  const u = new URL(url);
  const verified = sites.filter((s) => s.permissionLevel && s.permissionLevel !== "siteUnverifiedUser");
  const prefix = verified
    .filter((s) => !s.siteUrl.startsWith("sc-domain:") && url.startsWith(s.siteUrl.endsWith("/") ? s.siteUrl : `${s.siteUrl}/`))
    .sort((a, b) => b.siteUrl.length - a.siteUrl.length)[0];
  if (prefix) return prefix;
  const host = u.hostname.toLowerCase();
  return verified.find((s) => {
    if (!s.siteUrl.startsWith("sc-domain:")) return false;
    const d = s.siteUrl.slice("sc-domain:".length).toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  }) || null;
}

type Row = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };
const round = (r: Row) => ({ clicks: r.clicks, impressions: r.impressions, ctr: Math.round(r.ctr * 10000) / 100, position: Math.round(r.position * 10) / 10 });
const LIMITS_NOTE = [
  "Search Analytics data is delayed by about 2–3 days and is aggregated by Google; small numbers may be hidden for privacy.",
  "URL Inspection reflects Google's last crawl of the indexed version, not a live test, and is subject to a daily quota per property.",
  "Data is shown only for properties the connected Google account is verified for.",
];

export async function fetchSearchConsole(owner: string | null, url: string, signal?: AbortSignal, now = new Date()): Promise<SearchConsoleResult> {
  if (!gscConfigured()) return { status: "not_configured", message: "Not verified through Search Console: the integration is not configured on this server.", limitations: [] };
  const token = await accessToken(owner);
  if (!token) return { status: "not_connected", message: "Not verified through Search Console: no Google account is connected for this browser.", limitations: [] };
  try {
    const sites = await api<{ siteEntry?: GscSite[] }>(token, "GET", `${API}/webmasters/v3/sites`, undefined, signal);
    if (sites.status !== 200) return { status: "error", message: `Search Console returned HTTP ${sites.status} when listing properties.`, limitations: LIMITS_NOTE };
    const prop = matchProperty(url, sites.json.siteEntry || []);
    if (!prop) return { status: "no_matching_property", message: "Not verified through Search Console: the connected account has no verified property covering this URL.", limitations: LIMITS_NOTE };
    const end = new Date(now.getTime() - 3 * 86_400_000);
    const start = new Date(end.getTime() - 27 * 86_400_000);
    const d = (x: Date) => x.toISOString().slice(0, 10);
    const base = `${API}/webmasters/v3/sites/${encodeURIComponent(prop.siteUrl)}/searchAnalytics/query`;
    const range = { startDate: d(start), endDate: d(end) };
    const pageFilter = { dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: url }] }] };
    const [totals, pageTotals, queries, inspect] = await Promise.all([
      api<{ rows?: Row[] }>(token, "POST", base, { ...range, dataState: "final" }, signal),
      api<{ rows?: Row[] }>(token, "POST", base, { ...range, ...pageFilter }, signal),
      api<{ rows?: Row[] }>(token, "POST", base, { ...range, ...pageFilter, dimensions: ["query"], rowLimit: 10 }, signal),
      api<{ inspectionResult?: { indexStatusResult?: Record<string, string> } }>(token, "POST", `${API}/v1/urlInspection/index:inspect`, { inspectionUrl: url, siteUrl: prop.siteUrl }, signal),
    ]);
    const ir = inspect.json.inspectionResult?.indexStatusResult;
    return {
      status: "ok",
      message: `Data retrieved from Google Search Console for ${prop.siteUrl}.`,
      property: prop.siteUrl,
      retrievedAt: new Date().toISOString(),
      dateRange: { start: range.startDate, end: range.endDate },
      totals: totals.json.rows?.[0] ? round(totals.json.rows[0]) : { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      pageTotals: pageTotals.json.rows?.[0] ? round(pageTotals.json.rows[0]) : null,
      topQueries: (queries.json.rows || []).map((r) => ({ query: r.keys?.[0] || "", ...round(r) })),
      inspection: inspect.status === 200 && ir
        ? { verdict: ir.verdict ?? null, coverageState: ir.coverageState ?? null, indexingState: ir.indexingState ?? null, lastCrawlTime: ir.lastCrawlTime ?? null, googleCanonical: ir.googleCanonical ?? null, robotsTxtState: ir.robotsTxtState ?? null }
        : { verdict: null, coverageState: null, indexingState: null, lastCrawlTime: null, googleCanonical: null, robotsTxtState: null, error: `URL Inspection unavailable (HTTP ${inspect.status}${inspect.json.error?.message ? `: ${String(inspect.json.error.message).slice(0, 120)}` : ""}).` },
      limitations: LIMITS_NOTE,
    };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { status: "error", message: "Search Console request failed. The rest of the audit is unaffected.", limitations: LIMITS_NOTE };
  }
}
