import { describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Agent, request } from "undici";
import { createGuardedLookup, resolveAndValidate, safeFetch, BlockedAddressError } from "@/lib/security/safe-fetch";

type LookupCb = (err: NodeJS.ErrnoException | null, addrs: { address: string; family: number }[]) => void;
const fakeLookup = (addrs: string[]) =>
  ((_h: string, _o: unknown, cb: LookupCb) => cb(null, addrs.map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 })))) as never;

describe("guarded DNS lookup (connect-time pinning)", () => {
  it("rejects when any resolved address is private", async () => {
    const lookup = createGuardedLookup(fakeLookup(["93.184.216.34", "10.0.0.1"]));
    await expect(new Promise((res, rej) => lookup("evil.example", { all: true }, (e, a) => (e ? rej(e) : res(a))))).rejects.toBeInstanceOf(BlockedAddressError);
  });
  it("passes public addresses through in both callback forms", async () => {
    const lookup = createGuardedLookup(fakeLookup(["93.184.216.34"]));
    const single = await new Promise((res) => lookup("ok.example", {}, (_e, a, f) => res([a, f])));
    expect(single).toEqual(["93.184.216.34", 4]);
  });
  it("blocks a real connection to a rebinding host that resolves to loopback", async () => {
    const server = http.createServer((_q, s) => s.end("secret")).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as AddressInfo).port;
    const agent = new Agent({ connect: { lookup: createGuardedLookup(fakeLookup(["127.0.0.1"])) as never } });
    await expect(request(`http://rebind.example:${port}/`, { dispatcher: agent })).rejects.toThrow();
    server.close();
  });
});

describe("resolveAndValidate / safeFetch policy", () => {
  it("rejects private IP literals before any connection", async () => {
    await expect(resolveAndValidate(new URL("http://127.0.0.1/"))).rejects.toThrow(/not publicly routable/);
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/not publicly routable/);
  });
  it("rejects unsupported schemes and ports", async () => {
    await expect(safeFetch("ftp://example.com/")).rejects.toThrow(/http and https/);
    await expect(safeFetch("http://example.com:6379/")).rejects.toThrow(/web ports/);
  });
});
