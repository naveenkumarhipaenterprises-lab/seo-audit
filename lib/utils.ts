import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function scoreTone(score: number | null) {
  if (score === null) return { text: "text-slate-400", bg: "bg-slate-100", ring: "#cbd5e1", label: "Not tested" };
  if (score >= 80) return { text: "text-green-700", bg: "bg-green-50", ring: "#16a34a", label: "Good" };
  if (score >= 50) return { text: "text-amber-700", bg: "bg-amber-50", ring: "#d97706", label: "Needs work" };
  return { text: "text-red-700", bg: "bg-red-50", ring: "#dc2626", label: "Poor" };
}

export function hostOf(u: string) {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}

/** Only http(s) URLs are ever rendered as links to crawled content. */
export function safeHref(u: string): string | undefined {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? p.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}
