import { describe, expect, it } from "vitest";
import { normalizeAndValidateUrl, UrlValidationError } from "@/lib/security/url";
import { blockedAddressReason } from "@/lib/security/ip";

describe("normalizeAndValidateUrl", () => {
  it("adds https and strips the fragment", () => {
    expect(normalizeAndValidateUrl("example.com/page#x").toString()).toBe("https://example.com/page");
  });
  it.each([
    ["ftp://example.com", /http and https/],
    ["javascript:alert(1)", /http and https/],
    ["file:///etc/passwd", /http and https/],
    ["http://user:pass@example.com", /credentials/],
    ["http://localhost:3000", /web ports|Local/],
    ["http://localhost", /Local/],
    ["http://foo.localhost", /Local/],
    ["http://printer.local", /Local/],
    ["http://metadata.google.internal/computeMetadata/v1/", /Local/],
    ["http://127.0.0.1", /not publicly routable/],
    ["http://2130706433", /not publicly routable/],
    ["http://0x7f.0.0.1", /not publicly routable/],
    ["http://10.0.0.5", /not publicly routable/],
    ["http://192.168.1.1", /not publicly routable/],
    ["http://172.16.4.4", /not publicly routable/],
    ["http://169.254.169.254/latest/meta-data", /not publicly routable/],
    ["http://100.64.0.1", /not publicly routable/],
    ["http://0.0.0.0", /not publicly routable/],
    ["http://[::1]", /not publicly routable/],
    ["http://[::ffff:127.0.0.1]", /not publicly routable/],
    ["http://[fd00:ec2::254]", /not publicly routable/],
    ["http://[fe80::1]", /not publicly routable/],
    ["http://intranet", /fully qualified/],
    ["https://example.com:22", /web ports/],
    ["", /Enter a website URL/],
    ["http://", /valid URL/],
  ])("rejects %s", (input, msg) => {
    expect(() => normalizeAndValidateUrl(input)).toThrowError(msg);
  });
  it("accepts public IPs and IDNs", () => {
    expect(normalizeAndValidateUrl("http://8.8.8.8").hostname).toBe("8.8.8.8");
    expect(normalizeAndValidateUrl("https://bücher.de").hostname).toBe("xn--bcher-kva.de");
  });
  it("throws a typed error", () => {
    expect(() => normalizeAndValidateUrl("ftp://x.com")).toThrow(UrlValidationError);
  });
});

describe("blockedAddressReason", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.100.1.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fc00::1", "fe80::1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:a00:1::"])(
    "blocks %s",
    (ip) => expect(blockedAddressReason(ip)).not.toBeNull(),
  );
  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])("allows %s", (ip) => expect(blockedAddressReason(ip)).toBeNull());
});
