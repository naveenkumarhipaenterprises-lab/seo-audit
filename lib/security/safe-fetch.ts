import "server-only";
import dns from "node:dns";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { Agent, ProxyAgent, request, type Dispatcher } from "undici";
import { blockedAddressReason, isIpLiteral } from "./ip";
import { assertUrlAllowed, UrlValidationError } from "./url";
import { CRAWLER_USER_AGENT, LIMITS } from "../config";

export class BlockedAddressError extends UrlValidationError {
  constructor(host: string, reason: string) {
    super(`${host} resolves to a non-public address (${reason}).`);
    this.name = "BlockedAddressError";
  }
}

export class FetchFailure extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "FetchFailure";
  }
}

type LookupAddress = { address: string; family: number };
type LookupFn = (
  hostname: string,
  options: { all?: boolean; family?: number } | number | undefined,
  callback: (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void,
) => void;

/**
 * Wraps a DNS lookup so that the socket only ever connects to addresses that passed
 * validation. Because the check runs inside the connection's own lookup, the address
 * that is validated is the address that is used, which defeats DNS rebinding between
 * a pre-check and the connect.
 */
export function createGuardedLookup(base: typeof dns.lookup = dns.lookup): LookupFn {
  return (hostname, options, callback) => {
    base(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses as LookupAddress[];
      if (!list.length) return callback(Object.assign(new Error("No addresses"), { code: "ENOTFOUND" }));
      for (const a of list) {
        const reason = blockedAddressReason(a.address);
        if (reason) return callback(new BlockedAddressError(hostname, reason) as unknown as NodeJS.ErrnoException);
      }
      const wantAll = typeof options === "object" && options?.all;
      if (wantAll) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

/**
 * Development-only escape hatch for environments whose only egress is an HTTPS proxy
 * (for example sandboxed CI). In this mode the proxy resolves DNS, so addresses are
 * pre-validated with DNS-over-HTTPS and the proxy itself must also block private
 * networks. Production deployments should leave OUTBOUND_HTTPS_PROXY unset.
 */
const PROXY_URL = process.env.OUTBOUND_HTTPS_PROXY || "";
let dispatcher: Dispatcher | null = null;
function getDispatcher(): Dispatcher {
  if (dispatcher) return dispatcher;
  dispatcher = PROXY_URL
    ? new ProxyAgent({ uri: PROXY_URL, connect: { timeout: 10_000 } })
    : new Agent({
        connect: { lookup: createGuardedLookup() as never, timeout: 10_000 },
        connections: 32,
      });
  return dispatcher;
}

/** Dispatcher for fixed, trusted API hosts (Google APIs). Not used for crawled URLs. */
let apiDispatcherInstance: Dispatcher | null = null;
export function apiDispatcher(): Dispatcher {
  if (!apiDispatcherInstance) apiDispatcherInstance = PROXY_URL ? new ProxyAgent({ uri: PROXY_URL }) : new Agent();
  return apiDispatcherInstance;
}

export function usingOutboundProxy() {
  return Boolean(PROXY_URL);
}

async function dohResolve(host: string): Promise<string[]> {
  const out: string[] = [];
  for (const type of ["A", "AAAA"]) {
    const res = await request(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`, {
      dispatcher: getDispatcher(),
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await res.body.json()) as { Answer?: { type: number; data: string }[] };
    for (const a of json.Answer || []) if (a.type === 1 || a.type === 28) out.push(a.data);
  }
  return out;
}

/** Resolves the hostname and rejects it if any address is non-public. */
export async function resolveAndValidate(url: URL): Promise<string[]> {
  assertUrlAllowed(url);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host)) return [host];
  let addresses: string[];
  try {
    addresses = PROXY_URL
      ? await dohResolve(host)
      : (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    if (PROXY_URL && process.env.OUTBOUND_PROXY_SKIP_DNS_CHECK === "1") {
      // Explicit opt-in for proxies that cannot reach a DoH resolver. The proxy is
      // then the only network-level control; never enable this in production.
      return [];
    }
    throw new UrlValidationError(`The domain ${host} could not be resolved.`);
  }
  if (!addresses.length) throw new UrlValidationError(`The domain ${host} has no DNS address records.`);
  for (const a of addresses) {
    const reason = blockedAddressReason(a);
    if (reason) throw new BlockedAddressError(host, reason);
  }
  return addresses;
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface SafeResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
  redirects: RedirectHop[];
  timeMs: number;
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
  range?: string;
  signal?: AbortSignal;
  maxRedirects?: number;
}

function flattenHeaders(h: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    // Set-Cookie values contain commas (Expires dates), so they are joined with newlines instead.
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(k.toLowerCase() === "set-cookie" ? "\n" : ", ") : v;
  }
  return out;
}

/** Destroys a stream without letting a late "aborted" error become an uncaught exception. */
function quietDestroy(stream: Readable) {
  stream.on("error", () => {});
  stream.destroy();
}

/** Reads (and if needed decompresses) a body, stopping at maxBytes of decoded data. */
async function readCapped(stream: Readable, encoding: string | undefined, maxBytes: number) {
  let source: Readable = stream;
  const enc = (encoding || "").toLowerCase().trim();
  if (enc === "gzip" || enc === "x-gzip") source = stream.pipe(zlib.createGunzip());
  else if (enc === "deflate") source = stream.pipe(zlib.createInflate());
  else if (enc === "br") source = stream.pipe(zlib.createBrotliDecompress());
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  try {
    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (total + buf.length > maxBytes) {
        chunks.push(buf.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(buf);
      total += buf.length;
    }
  } finally {
    if (truncated) {
      quietDestroy(stream);
      if (source !== stream) quietDestroy(source);
    }
  }
  return { body: Buffer.concat(chunks), truncated };
}

export function describeFetchError(err: unknown): FetchFailure {
  if (err instanceof FetchFailure) return err;
  if (err instanceof UrlValidationError) return new FetchFailure(err.message, "blocked");
  const e = err as { name?: string; code?: string; cause?: { code?: string; name?: string }; message?: string };
  const code = e?.code || e?.cause?.code || e?.name || "";
  if (e?.cause && (e.cause as Error).name === "BlockedAddressError") {
    return new FetchFailure((e.cause as Error).message, "blocked");
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new FetchFailure("The domain could not be resolved.", "dns");
  if (code === "ECONNREFUSED") return new FetchFailure("The server refused the connection.", "refused");
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return new FetchFailure("The connection was reset by the server.", "reset");
  if (code === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT")
    return new FetchFailure("The request timed out.", "timeout");
  if (/Proxy response \((\d+)\)/.test(e?.message || "")) return new FetchFailure("The outbound proxy refused the connection.", "proxy");
  if (code === "AbortError" || code === "UND_ERR_ABORTED") return new FetchFailure("The request was cancelled.", "aborted");
  if (/CERT|SSL|TLS/i.test(code)) return new FetchFailure("The site's TLS certificate could not be verified.", "tls");
  return new FetchFailure("The request failed.", code || "unknown");
}

/**
 * Fetches a public URL with SSRF protection, manual redirect handling (every hop is
 * re-validated), a hard timeout and a decoded-size cap.
 */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const started = Date.now();
  const maxRedirects = opts.maxRedirects ?? LIMITS.maxRedirects;
  const maxBytes = opts.maxBytes ?? LIMITS.maxHtmlBytes;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? LIMITS.pageTimeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const redirects: RedirectHop[] = [];
  let current = new URL(input);

  try {
    for (let hop = 0; ; hop++) {
      await resolveAndValidate(current);
      const headers: Record<string, string> = {
        "user-agent": CRAWLER_USER_AGENT,
        accept: opts.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "en;q=0.9,*;q=0.5",
      };
      if (opts.range) headers.range = opts.range;
      const res = await request(current, {
        method: opts.method || "GET",
        headers,
        dispatcher: getDispatcher(),
        signal,
        headersTimeout: opts.timeoutMs ?? LIMITS.pageTimeoutMs,
        bodyTimeout: opts.timeoutMs ?? LIMITS.pageTimeoutMs,
      });
      const h = flattenHeaders(res.headers as Record<string, string | string[]>);
      if (res.statusCode >= 300 && res.statusCode < 400 && h.location) {
        quietDestroy(res.body as unknown as Readable);
        if (maxRedirects === 0) {
          return { url: current.toString(), status: res.statusCode, headers: h, body: Buffer.alloc(0), truncated: false, redirects, timeMs: Date.now() - started };
        }
        if (hop >= maxRedirects) throw new FetchFailure(`Too many redirects (more than ${maxRedirects}).`, "redirects");
        const next = new URL(h.location, current);
        next.hash = "";
        redirects.push({ url: current.toString(), status: res.statusCode, location: next.toString() });
        if (redirects.some((r) => r.url === next.toString())) throw new FetchFailure("Redirect loop detected.", "redirect-loop");
        assertUrlAllowed(next);
        current = next;
        continue;
      }
      if (opts.method === "HEAD") {
        quietDestroy(res.body as unknown as Readable);
        return { url: current.toString(), status: res.statusCode, headers: h, body: Buffer.alloc(0), truncated: false, redirects, timeMs: Date.now() - started };
      }
      const { body, truncated } = await readCapped(res.body as unknown as Readable, h["content-encoding"], maxBytes);
      return { url: current.toString(), status: res.statusCode, headers: h, body, truncated, redirects, timeMs: Date.now() - started };
    }
  } catch (err) {
    throw describeFetchError(err);
  }
}
