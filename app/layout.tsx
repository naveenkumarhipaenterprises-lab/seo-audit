import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import { latestReportSummary } from "@/lib/server-data";
import { hostOf } from "@/lib/utils";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const latest = await latestReportSummary();
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <AppShell appName={APP_NAME} tagline={APP_TAGLINE} currentSite={latest ? hostOf(latest.finalUrl) : null}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
