import zlib from "node:zlib";
import * as cheerio from "cheerio";
import type { SitemapSummary } from "./types";
import type { Fetcher } from "./fetcher";
import { LIMITS } from "../config";

export function normalizeForCompare(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    let s = `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? ":" + url.port : ""}${url.pathname}${url.search}`;
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return u;
  }
}

export async function checkSitemaps(
  pageUrl: string,
  declared: string[],
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<SitemapSummary> {
  const origin = new URL(pageUrl).origin;
  const queue = declared.length ? [...declared] : [`${origin}/sitemap.xml`];
  const checked: SitemapSummary["checked"] = [];
  const target = normalizeForCompare(pageUrl);
  let totalUrls = 0;
  let includes = false;
  let truncated = false;
  const urls: string[] = [];

  while (queue.length && checked.length < LIMITS.maxSitemapsFetched) {
    const url = queue.shift()!;
    try {
      const res = await fetcher.fetch(url, { maxBytes: LIMITS.maxSitemapBytes, timeoutMs: LIMITS.subresourceTimeoutMs, accept: "application/xml,text/xml,*/*", signal });
      if (res.status >= 400) {
        checked.push({ url, httpStatus: res.status, type: "error", urlCount: 0, error: `HTTP ${res.status}` });
        continue;
      }
      let body = res.body;
      if (body[0] === 0x1f && body[1] === 0x8b) {
        body = zlib.gunzipSync(body, { maxOutputLength: LIMITS.maxSitemapBytes });
      }
      if (res.truncated) truncated = true;
      const $ = cheerio.load(body.toString("utf8"), { xml: true });
      const root = $.root().children().first();
      const rootName = (root.get(0) as { tagName?: string } | undefined)?.tagName?.toLowerCase().replace(/^.*:/, "");
      if (rootName === "urlset") {
        const locs = $("url > loc").toArray().map((el) => $(el).text().trim());
        totalUrls += locs.length;
        for (const l of locs) if (urls.length < LIMITS.maxSitemapUrlsKept) urls.push(l);
        if (locs.some((l) => normalizeForCompare(l) === target)) includes = true;
        checked.push({ url, httpStatus: res.status, type: "urlset", urlCount: locs.length });
      } else if (rootName === "sitemapindex") {
        const locs = $("sitemap > loc").toArray().map((el) => $(el).text().trim());
        checked.push({ url, httpStatus: res.status, type: "sitemapindex", urlCount: locs.length });
        for (const l of locs) if (!checked.some((c) => c.url === l) && !queue.includes(l)) queue.push(l);
      } else {
        checked.push({ url, httpStatus: res.status, type: "invalid", urlCount: 0, error: "Root element is not <urlset> or <sitemapindex>." });
      }
    } catch (e) {
      checked.push({ url, httpStatus: null, type: "error", urlCount: 0, error: (e as Error).message });
    }
  }
  if (queue.length) truncated = true;
  const anyValid = checked.some((c) => c.type === "urlset" || c.type === "sitemapindex");
  const fullyChecked = !truncated;
  return {
    status: anyValid ? "found" : checked.every((c) => c.httpStatus === 404 || c.httpStatus === 410) ? "not_found" : "error",
    checked,
    totalUrls,
    // Only claim "not included" when every discovered sitemap was read.
    includesAuditedUrl: includes ? true : anyValid && fullyChecked ? false : null,
    truncated,
    urls,
  };
}
