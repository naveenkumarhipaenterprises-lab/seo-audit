/** Same normalisation as sitemap.normalizeForCompare, without server-only imports, for client code. */
export function normalizeForCompareClient(u: string): string {
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
