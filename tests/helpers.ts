import { readFileSync } from "node:fs";
import path from "node:path";
import type { Fetcher } from "@/lib/audit/fetcher";
import type { SafeFetchOptions, SafeResponse } from "@/lib/security/safe-fetch";
import { assertUrlAllowed } from "@/lib/security/url";
import type { AuditDeps } from "@/lib/audit/run";
import type { AuditInput, AuditRecord, PerformanceResult, RenderResult } from "@/lib/audit/types";
import { notTestedPerformance } from "@/lib/audit/pagespeed";

export const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");

export interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  redirect?: string;
  error?: string;
}

/** In-memory fetcher that mimics safeFetch (redirect following + URL policy) for fixtures. */
export function fixtureFetcher(routes: Record<string, Route>): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetch(url: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
      const redirects: SafeResponse["redirects"] = [];
      let current = url;
      for (let i = 0; i < 6; i++) {
        assertUrlAllowed(new URL(current));
        calls.push(`${opts.method || "GET"} ${current}`);
        const r = routes[current];
        if (!r) return { url: current, status: 404, headers: { "content-type": "text/html" }, body: Buffer.from("not found"), truncated: false, redirects, timeMs: 1 };
        if (r.error) throw new Error(r.error);
        if (r.redirect) {
          const next = new URL(r.redirect, current).toString();
          if (opts.maxRedirects === 0) return { url: current, status: r.status || 301, headers: { location: next }, body: Buffer.alloc(0), truncated: false, redirects, timeMs: 1 };
          redirects.push({ url: current, status: r.status || 301, location: next });
          current = next;
          continue;
        }
        const body = Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body || "");
        const max = opts.maxBytes ?? Infinity;
        return { url: current, status: r.status || 200, headers: { "content-type": "text/html; charset=utf-8", ...r.headers }, body: body.subarray(0, max), truncated: body.length > max, redirects, timeMs: 5 };
      }
      throw new Error("Too many redirects");
    },
  };
}

export function testDeps(fetcher: Fetcher, overrides: Partial<AuditDeps> = {}): AuditDeps & { saved: AuditRecord[] } {
  const saved: AuditRecord[] = [];
  return {
    fetcher,
    validate: async () => undefined,
    pageSpeed: async (_u, s): Promise<PerformanceResult> => notTestedPerformance(s, "disabled in test"),
    render: async (): Promise<RenderResult> => ({ status: "not_tested", error: "disabled in test", viewports: [] }),
    renderingAvailable: false,
    pageSpeedConfigured: false,
    save: async (r) => {
      saved.push(r);
    },
    saved,
    ...overrides,
  };
}

export const baseInput = (url: string, extra: Partial<AuditInput> = {}): AuditInput => ({
  url,
  primaryKeyword: "",
  secondaryKeywords: [],
  competitorUrls: [],
  respectRobots: true,
  renderJs: false,
  runPerformance: false,
  enableAi: false,
  linksToCheck: 10,
  checkExternalLinks: false,
  ...extra,
});

/** 1x1 PNG. */
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
