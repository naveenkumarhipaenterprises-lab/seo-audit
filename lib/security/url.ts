import ipaddr from "ipaddr.js";
import { blockedAddressReason } from "./ip";

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlValidationError";
  }
}

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

/**
 * Normalises user input ("example.com" -> "https://example.com/") and performs the
 * syntactic part of URL validation. DNS-level checks happen in resolveAndValidate
 * and again at connect time (see safe-fetch.ts), so a string check alone is never
 * relied upon.
 */
export function normalizeAndValidateUrl(input: string): URL {
  const raw = (input || "").trim();
  if (!raw) throw new UrlValidationError("Enter a website URL.");
  if (raw.length > 2048) throw new UrlValidationError("URL is too long.");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UrlValidationError("That does not look like a valid URL.");
  }
  assertUrlAllowed(url);
  url.hash = "";
  return url;
}

/** Syntactic checks applied to the first URL and to every redirect hop. */
export function assertUrlAllowed(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlValidationError("Only http and https URLs are supported.");
  }
  if (url.username || url.password) {
    throw new UrlValidationError("URLs containing credentials are not allowed.");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UrlValidationError("Only standard web ports (80, 443, 8080, 8443) are allowed.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new UrlValidationError("URL has no hostname.");
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UrlValidationError("Local and internal hostnames are not allowed.");
  }
  if (ipaddr.isValid(host)) {
    // ipaddr.isValid also accepts odd IPv4 forms like "0x7f.1" which URL() already
    // normalises to dotted decimal, so parsing here is reliable.
    const reason = blockedAddressReason(host);
    if (reason) throw new UrlValidationError(`That address is not publicly routable (${reason}).`);
    return;
  }
  if (!host.includes(".")) {
    throw new UrlValidationError("Use a fully qualified public domain name.");
  }
  if (!/^[a-z0-9.-]+$/.test(host)) {
    // URL() converts IDNs to punycode, so anything else here is malformed.
    throw new UrlValidationError("Hostname contains unsupported characters.");
  }
}
