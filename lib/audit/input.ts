import { z } from "zod";
import { LIMITS } from "../config";
import type { AuditInput } from "./types";

const keyword = z.string().trim().max(100);
const shortText = z.string().trim().max(120);
export const auditInputSchema = z.object({
  url: z.string().trim().min(1, "Enter a website URL.").max(2048),
  mode: z.enum(["quick", "full"]).optional().default("quick"),
  maxPages: z.number({ error: "Maximum pages must be a number." }).int("Maximum pages must be a whole number.")
    .min(2, "Full Site Audit needs at least 2 pages.").max(LIMITS.maxCrawlPages, `Maximum pages is limited to ${LIMITS.maxCrawlPages}.`)
    .optional().default(LIMITS.defaultCrawlPages),
  maxDepth: z.number({ error: "Crawl depth must be a number." }).int("Crawl depth must be a whole number.")
    .min(1, "Crawl depth must be at least 1.").max(LIMITS.maxCrawlDepth, `Crawl depth is limited to ${LIMITS.maxCrawlDepth}.`)
    .optional().default(LIMITS.defaultCrawlDepth),
  primaryKeyword: keyword.optional().default(""),
  secondaryKeywords: z.array(keyword).max(10, "Use at most 10 secondary keywords.").optional().default([]),
  competitorUrls: z.array(z.string().trim().max(2048)).max(LIMITS.maxCompetitors, `Add at most ${LIMITS.maxCompetitors} competitor URLs.`).optional().default([]),
  businessName: shortText.optional().default(""),
  businessLocation: shortText.optional().default(""),
  businessType: shortText.optional().default(""),
  respectRobots: z.boolean().optional().default(true),
  renderJs: z.boolean().optional().default(true),
  runPerformance: z.boolean().optional().default(true),
  performanceStrategy: z.enum(["mobile", "desktop", "both"]).optional().default("both"),
  useSearchConsole: z.boolean().optional().default(false),
  enableAi: z.boolean().optional().default(false),
  linksToCheck: z.number().int().min(0).max(LIMITS.maxLinksToCheck).optional().default(LIMITS.defaultLinksToCheck),
  checkExternalLinks: z.boolean().optional().default(false),
});

export function parseAuditInput(body: unknown): { ok: true; input: AuditInput } | { ok: false; error: string } {
  const r = auditInputSchema.safeParse(body);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message || "Invalid input." };
  const v = r.data;
  return {
    ok: true,
    input: {
      ...v,
      enableAi: false,
      secondaryKeywords: v.secondaryKeywords.filter(Boolean),
      competitorUrls: Array.from(new Set(v.competitorUrls.filter(Boolean))),
    },
  };
}
