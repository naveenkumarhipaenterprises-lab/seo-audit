import ipaddr from "ipaddr.js";

/**
 * Extra CIDRs blocked on top of ipaddr.js range classification. Covers ranges that
 * are not "private" in the RFC1918 sense but must never be reachable from a crawler
 * (documentation, benchmarking, IETF protocol assignments, cloud metadata).
 */
const EXTRA_BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["100.64.0.0", 10],
  ["169.254.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/**
 * Returns a reason string when the address must not be contacted, or null when it is
 * a public unicast address. Handles IPv4, IPv6, IPv4-mapped IPv6 and NAT64 forms.
 */
export function blockedAddressReason(address: string): string | null {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return "unparseable IP address";
  }
  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return blockedAddressReason(v6.toIPv4Address().toString());
    const range = v6.range();
    if (range !== "unicast") return `IPv6 ${range} range`;
    return null;
  }
  const v4 = parsed as ipaddr.IPv4;
  const range = v4.range();
  if (range !== "unicast") return `IPv4 ${range} range`;
  for (const [base, bits] of EXTRA_BLOCKED_V4) {
    if (v4.match(ipaddr.parse(base) as ipaddr.IPv4, bits)) return `reserved range ${base}/${bits}`;
  }
  return null;
}

export function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return ipaddr.isValid(h) && (ipaddr.IPv4.isValidFourPartDecimal(h) || h.includes(":"));
}
