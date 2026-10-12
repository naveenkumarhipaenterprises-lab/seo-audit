"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonClass } from "@/components/ui/button";

export function GscConnect({ configured, connected, connectedAt, notice }: { configured: boolean; connected: boolean; connectedAt?: string; notice?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const messages: Record<string, string> = {
    connected: "Google Search Console connected.",
    denied: "Access was not granted in Google.",
    error: "The connection could not be completed. Check the OAuth settings and try again.",
  };
  if (!configured) {
    return <p className="text-sm text-slate-500">Not configured. Set GSC_CLIENT_ID, GSC_CLIENT_SECRET, GSC_REDIRECT_URI and GSC_TOKEN_SECRET on the server (see README). The rest of the audit works without it; indexing shows as “Not verified through Search Console”.</p>;
  }
  return (
    <div className="space-y-2 text-sm">
      {notice && messages[notice] && <p className={notice === "connected" ? "text-green-700" : "text-red-700"} role="status">{messages[notice]}</p>}
      {connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-slate-700">Connected for this browser{connectedAt ? ` since ${new Date(connectedAt).toLocaleDateString()}` : ""}. Only properties your Google account is verified for are used.</span>
          <Button variant="secondary" size="sm" disabled={busy} onClick={async () => {
            setBusy(true);
            await fetch("/api/gsc/disconnect", { method: "POST" });
            setBusy(false);
            router.replace("/settings");
            router.refresh();
          }}>Disconnect</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-slate-600">Read-only access to Search Analytics and URL Inspection. Entering a URL never grants access by itself.</span>
          <a href="/api/gsc/connect" className={buttonClass("primary", "sm")}>Connect Google Search Console</a>
        </div>
      )}
    </div>
  );
}
