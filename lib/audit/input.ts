import { z } from "zod";
import { LIMITS } from "../config";
import type { AuditInput } from "./types";

const keyword = z.string().trim().max(100);
export const auditInputSchema = z.object({
  url: z.string().trim().min(1, "Enter a website URL.").max(2048),
  primaryKeyword: keyword.optional().default(""),
  secondaryKeywords: z.array(keyword).max(10).optional().default([]),
  competitorUrls: z.array(z.string().trim().max(2048)).max(5).optional().default([]),
  respectRobots: z.boolean().optional().default(true),
  renderJs: z.boolean().optional().default(true),
  runPerformance: z.boolean().optional().default(true),
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
    input: { ...v, secondaryKeywords: v.secondaryKeywords.filter(Boolean), competitorUrls: v.competitorUrls.filter(Boolean) },
  };
}
