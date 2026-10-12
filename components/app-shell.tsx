"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Bot, FileText, FolderKanban, History, LayoutDashboard, Menu, MessageCircleQuestion, PlusCircle, Search, Settings, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/audit/new", label: "New Audit", icon: PlusCircle },
  { href: "/history", label: "Audit History", icon: History },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/analysis/seo", label: "SEO Analysis", icon: Search },
  { href: "/analysis/aeo", label: "AEO Analysis", icon: MessageCircleQuestion },
  { href: "/analysis/geo", label: "GEO Analysis", icon: Bot },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors", active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Logo({ name }: { name: string }) {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white"><Sparkles className="h-4 w-4" aria-hidden /></span>
      <span className="truncate">{name}</span>
    </Link>
  );
}

export function AppShell({ appName, tagline, currentSite, children }: { appName: string; tagline: string; currentSite: string | null; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex">
        <Logo name={appName} />
        <p className="mt-1 mb-6 pl-10 text-xs text-slate-500">{tagline}</p>
        <NavLinks />
        <div className="mt-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          <BarChart3 className="mb-1 h-4 w-4 text-brand-600" aria-hidden />
          Scores are this tool&apos;s diagnostic model, not official search engine scores.
        </div>
      </aside>

      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-slate-900/30" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white px-4 py-5 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <Logo name={appName} />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close navigation"><X className="h-5 w-5" /></button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open navigation" data-testid="open-nav">
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden"><Logo name={appName} /></div>
          <div className="ml-auto flex min-w-0 items-center gap-2 text-sm">
            {currentSite ? (
              <span className="hidden min-w-0 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600 sm:flex">
                <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" aria-hidden />
                <span className="truncate">Latest: {currentSite}</span>
              </span>
            ) : (
              <span className="hidden text-slate-400 sm:inline">No audits yet</span>
            )}
            <Link href="/audit/new" className="hidden rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700 sm:inline-flex">New audit</Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
