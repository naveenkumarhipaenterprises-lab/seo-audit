import "server-only";
import type { RenderResult } from "./types";
import { LIMITS } from "../config";
import { assertUrlAllowed } from "../security/url";
import { resolveAndValidate } from "../security/safe-fetch";

export function renderingConfigured(): boolean {
  return Boolean(process.env.CHROMIUM_PATH) || process.env.ENABLE_BROWSER_RENDERING === "1";
}

const VIEWPORTS = [
  { name: "Mobile", width: 375, height: 812, isMobile: true },
  { name: "Tablet", width: 768, height: 1024, isMobile: true },
  { name: "Desktop", width: 1366, height: 900, isMobile: false },
];

/**
 * Loads the page in headless Chromium at three viewport widths. Every request the
 * page makes (scripts, images, XHR, iframes) is intercepted and re-validated against
 * the SSRF policy, WebSockets and service workers are blocked, and the browser runs
 * outside the application origin, so crawled scripts never execute in our app.
 */
export async function renderPage(url: string, signal?: AbortSignal): Promise<RenderResult> {
  if (!renderingConfigured()) {
    return { status: "not_tested", error: "Browser rendering is not configured on this server (set CHROMIUM_PATH or ENABLE_BROWSER_RENDERING=1).", viewports: [] };
  }
  let browser: import("playwright-core").Browser | null = null;
  const hostCache = new Map<string, Promise<boolean>>();
  let blocked = 0;
  const allowed = (u: URL) => {
    const key = `${u.protocol}//${u.host}`;
    if (!hostCache.has(key)) {
      hostCache.set(
        key,
        (async () => {
          try {
            assertUrlAllowed(u);
            await resolveAndValidate(u);
            return true;
          } catch {
            return false;
          }
        })(),
      );
    }
    return hostCache.get(key)!;
  };
  const onAbort = () => browser?.close().catch(() => {});
  signal?.addEventListener("abort", onAbort);
  try {
    const { chromium } = await import("playwright-core");
    const proxy = process.env.OUTBOUND_HTTPS_PROXY ? { server: process.env.OUTBOUND_HTTPS_PROXY } : undefined;
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: true,
      proxy,
      args: ["--disable-dev-shm-usage", "--disable-background-networking", "--no-first-run"],
      chromiumSandbox: process.env.CHROMIUM_NO_SANDBOX === "1" ? false : undefined,
      timeout: 15_000,
    });
    const result: RenderResult = { status: "ok", viewports: [] };
    for (const vp of VIEWPORTS) {
      if (signal?.aborted) throw new Error("Cancelled");
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: vp.isMobile,
        serviceWorkers: "block",
        acceptDownloads: false,
        javaScriptEnabled: true,
        userAgent: vp.isMobile
          ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36 SearchScopeBot"
          : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 SearchScopeBot",
      });
      await context.routeWebSocket(/.*/, (ws) => ws.close());
      await context.route("**/*", async (route) => {
        const req = route.request();
        let u: URL;
        try {
          u = new URL(req.url());
        } catch {
          blocked++;
          return route.abort("blockedbyclient");
        }
        if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
        if (req.resourceType() === "media" || !(await allowed(u))) {
          blocked++;
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "load", timeout: LIMITS.renderTimeoutMs });
        await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
        const m = await page.evaluate(() => {
          const vw = window.innerWidth;
          const doc = document.documentElement;
          const all = Array.from(document.body?.querySelectorAll("*") || []).slice(0, 4000) as HTMLElement[];
          let clipped = 0;
          let textEls = 0;
          let smallText = 0;
          for (const el of all) {
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden") continue;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > vw + 2 && cs.position !== "fixed") clipped++;
            const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim().length > 2);
            if (ownText && r.width > 0) {
              textEls++;
              if (parseFloat(cs.fontSize) < 12) smallText++;
            }
          }
          const targets = Array.from(document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button]")) as HTMLElement[];
          let small = 0;
          let checked = 0;
          for (const t of targets.slice(0, 1000)) {
            const r = t.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const cs = getComputedStyle(t);
            if (cs.visibility === "hidden" || cs.display === "none") continue;
            // Inline links inside running text are exempt from target-size rules (WCAG 2.5.8).
            if (t.tagName === "A" && cs.display === "inline" && t.parentElement && /^(P|LI|TD|SPAN)$/.test(t.parentElement.tagName)) continue;
            checked++;
            if (r.width < 24 || r.height < 24) small++;
          }
          const wideImages = (Array.from(document.images) as HTMLImageElement[]).filter((i) => i.getBoundingClientRect().width > vw + 2).length;
          return {
            scrollWidth: Math.max(doc.scrollWidth, document.body?.scrollWidth || 0),
            innerWidth: vw,
            clipped,
            smallTextRatio: textEls ? smallText / textEls : 0,
            smallTapTargets: small,
            tapTargetsChecked: checked,
            wideImages,
            words: (document.body?.innerText || "").split(/\s+/).filter(Boolean).length,
            title: document.title,
            h1: document.querySelectorAll("h1").length,
          };
        });
        result.viewports.push({
          name: vp.name,
          width: vp.width,
          height: vp.height,
          scrollWidth: m.scrollWidth,
          horizontalOverflow: m.scrollWidth > m.innerWidth + 2,
          clippedElements: m.clipped,
          smallTextRatio: Math.round(m.smallTextRatio * 1000) / 1000,
          smallTapTargets: m.smallTapTargets,
          tapTargetsChecked: m.tapTargetsChecked,
          imagesWiderThanViewport: m.wideImages,
        });
        if (vp.name === "Desktop") {
          result.renderedWordCount = m.words;
          result.renderedTitle = m.title;
          result.renderedH1Count = m.h1;
        }
      } finally {
        await context.close().catch(() => {});
      }
    }
    result.blockedRequests = blocked;
    return result;
  } catch (e) {
    if (signal?.aborted) return { status: "error", error: "Cancelled.", viewports: [] };
    const msg = (e as Error).message || "";
    return {
      status: "error",
      error: /Executable doesn't exist|ENOENT|Failed to launch/i.test(msg)
        ? "Chromium could not be launched on this server."
        : /Timeout/i.test(msg)
          ? "The page did not finish loading in the browser within the time limit."
          : "Browser rendering failed for this page.",
      viewports: [],
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await browser?.close().catch(() => {});
  }
}
