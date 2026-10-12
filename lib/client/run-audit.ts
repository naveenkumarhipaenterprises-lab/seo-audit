import type { AuditEvent } from "@/lib/audit/types";

/** Posts an audit request and yields server events as they stream in (NDJSON). */
export async function streamAudit(body: unknown, onEvent: (e: AuditEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch("/api/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    let msg = `Request failed (HTTP ${res.status}).`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as AuditEvent);
    }
  }
}
