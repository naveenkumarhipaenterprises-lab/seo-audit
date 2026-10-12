import { builder, type CheckContext } from "./context";
import type { CheckResult } from "../types";

const LIMIT = "A limited set of public HTTP checks. It does not assess server configuration, software vulnerabilities or application security, and passing it does not mean the site is secure.";

export function securityChecks(ctx: CheckContext): CheckResult[] {
  const sec = ctx.security;
  const h = ctx.headers;
  const b = builder("security", "Security headers", ctx.url);
  const out: CheckResult[] = [];
  const https = ctx.url.startsWith("https:");

  if (sec) {
    out.push(b("sec-http-to-https", "HTTP redirects to HTTPS", !https ? "not_applicable" : sec.httpRefused ? "pass" : sec.httpRedirectsToHttps === null ? "not_tested" : sec.httpRedirectsToHttps ? "pass" : "fail", "high",
      !https ? "The site is not served over HTTPS." : sec.httpRefused ? "Plain HTTP (port 80) refused the connection, so no unencrypted version of the page is served." : sec.httpRedirectsToHttps === null ? `The http:// version could not be checked${sec.httpCheckError ? `: ${sec.httpCheckError}` : "."}` : sec.httpRedirectsToHttps ? "Requesting the http:// URL redirects to HTTPS." : "The http:// version of the URL does not redirect to HTTPS, so visitors and links can land on an unencrypted page.",
      sec.httpRedirectsToHttps === false ? "Add a permanent (301/308) redirect from HTTP to HTTPS for every URL." : "No action needed.",
      "Requested the http:// version of the final URL without following redirects.", [], LIMIT));
  }
  const hsts = h["strict-transport-security"];
  const maxAge = Number(hsts?.match(/max-age=(\d+)/i)?.[1] ?? 0);
  out.push(b("sec-hsts", "Strict-Transport-Security (HSTS)", !https ? "not_applicable" : !hsts ? "warning" : maxAge < 15552000 ? "warning" : "pass", "medium",
    !hsts ? "No Strict-Transport-Security header. Browsers may make an initial insecure request before being redirected." : maxAge < 15552000 ? `HSTS max-age is ${maxAge} seconds (under 180 days).` : `HSTS is set with max-age ${maxAge}.`,
    !hsts || maxAge < 15552000 ? "Send Strict-Transport-Security with max-age of at least 15552000 (180 days) once HTTPS works everywhere." : "No action needed.",
    "Response headers of the final URL.", hsts ? [`strict-transport-security: ${hsts}`] : [], LIMIT));
  const csp = h["content-security-policy"];
  out.push(b("sec-csp", "Content-Security-Policy", csp ? "pass" : "warning", "low",
    csp ? "A Content-Security-Policy header is present." : "No Content-Security-Policy header. CSP limits the impact of injected scripts.",
    csp ? "No action needed." : "Define a Content-Security-Policy (start in report-only mode).", "Response headers of the final URL.", csp ? [csp.slice(0, 200)] : [],
    "Presence only; the policy's strength is not evaluated."));
  const frame = h["x-frame-options"] || (csp && /frame-ancestors/i.test(csp) ? "csp frame-ancestors" : null);
  out.push(b("sec-clickjacking", "Clickjacking protection", frame ? "pass" : "warning", "low",
    frame ? "Framing is restricted (X-Frame-Options or CSP frame-ancestors)." : "Neither X-Frame-Options nor CSP frame-ancestors is set, so other sites can frame this page.",
    frame ? "No action needed." : "Send X-Frame-Options: SAMEORIGIN or a CSP frame-ancestors directive.", "Response headers of the final URL.", frame ? [String(frame)] : []));
  const nosniff = (h["x-content-type-options"] || "").toLowerCase() === "nosniff";
  out.push(b("sec-nosniff", "X-Content-Type-Options", nosniff ? "pass" : "warning", "low",
    nosniff ? "X-Content-Type-Options: nosniff is set." : "X-Content-Type-Options: nosniff is not set; browsers may MIME-sniff responses.",
    nosniff ? "No action needed." : "Send X-Content-Type-Options: nosniff.", "Response headers of the final URL."));
  const ref = h["referrer-policy"];
  out.push(b("sec-referrer-policy", "Referrer-Policy", ref ? "pass" : "info", "low",
    ref ? `Referrer-Policy: ${ref}.` : "No Referrer-Policy header; browsers default to strict-origin-when-cross-origin.",
    ref ? "No action needed." : "Optionally set an explicit Referrer-Policy.", "Response headers of the final URL."));
  if (sec) {
    out.push(b("sec-cookies", "Cookies set without Secure/HttpOnly", !https || !h["set-cookie"] ? "not_applicable" : sec.insecureCookies.length ? "warning" : "pass", "low",
      !h["set-cookie"] ? "The page did not set cookies in its response." : sec.insecureCookies.length ? `${sec.insecureCookies.length} cookie(s) are set without the Secure flag or without HttpOnly.` : "All cookies set by the response use Secure and HttpOnly.",
      sec.insecureCookies.length ? "Add Secure (and HttpOnly for cookies JavaScript does not need) to these cookies." : "No action needed.",
      "Parsed Set-Cookie headers of the final response.", sec.insecureCookies, "Cookies set by JavaScript or later requests are not seen. Some cookies (e.g. consent) are intentionally readable by scripts."));
  }
  const server = h["server"] || "";
  const powered = h["x-powered-by"] || "";
  const versioned = [server, powered].filter((v) => /\d+\.\d+/.test(v));
  out.push(b("sec-version-disclosure", "Software version disclosure", versioned.length ? "warning" : "pass", "low",
    versioned.length ? "Response headers reveal exact software versions, which helps attackers target known vulnerabilities." : "No exact software versions appear in Server or X-Powered-By headers.",
    versioned.length ? "Remove version numbers from Server and X-Powered-By headers." : "No action needed.", "Server and X-Powered-By response headers.", versioned));
  return out;
}

/** Parses Set-Cookie values (one per line) and lists cookie names missing Secure or HttpOnly. */
export function insecureCookies(setCookie: string | undefined): string[] {
  if (!setCookie) return [];
  return setCookie.split("\n").map((c) => c.trim()).filter(Boolean).flatMap((c) => {
    const name = c.split("=")[0].trim();
    const missing = [!/;\s*secure\b/i.test(c) && "Secure", !/;\s*httponly\b/i.test(c) && "HttpOnly"].filter(Boolean);
    return missing.length ? [`${name.slice(0, 60)}: missing ${missing.join(" and ")}`] : [];
  }).slice(0, 20);
}
