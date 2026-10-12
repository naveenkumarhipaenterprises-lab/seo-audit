import "server-only";
import { safeFetch, resolveAndValidate } from "../security/safe-fetch";
import { runPageSpeedCached } from "./pagespeed";
import { renderPage, renderingConfigured } from "./render";
import { getStore } from "../store";
import { fetchSearchConsole, gscConfigured } from "../integrations/gsc";
import type { AuditDeps } from "./run";

export function defaultDeps(): AuditDeps {
  return {
    fetcher: { fetch: safeFetch },
    validate: resolveAndValidate,
    pageSpeed: runPageSpeedCached,
    render: renderPage,
    renderingAvailable: renderingConfigured(),
    pageSpeedConfigured: Boolean(process.env.PAGESPEED_API_KEY),
    save: (r) => getStore().save(r),
    searchConsole: gscConfigured() ? fetchSearchConsole : undefined,
  };
}

/** Non-secret integration status for the settings page. Never returns key values. */
export function integrationStatus() {
  return {
    pagespeed: process.env.PAGESPEED_API_KEY ? "configured" : "keyless",
    rendering: renderingConfigured() ? "configured" : "not_configured",
    supabase: process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "configured_unused" : "not_configured",
    searchConsole: gscConfigured() ? "configured" : "not_configured",
    ai: "not_configured",
    accessGate: process.env.APP_PASSWORD ? "enabled" : "disabled",
    outboundProxy: process.env.OUTBOUND_HTTPS_PROXY ? "enabled" : "disabled",
    sharedHistory: process.env.AUDIT_SHARED_HISTORY === "1" ? "enabled" : "disabled",
  } as const;
}
