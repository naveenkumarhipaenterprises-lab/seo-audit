import type { JsonLdBlock } from "./parse";
import type { StructuredDataSummary } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function typesOf(item: Obj): string[] {
  return asArray(item["@type"] as string | string[]).map((t) => String(t).replace(/^.*[/#]/, ""));
}

/** Flattens top-level arrays and @graph containers into individual items. */
export function flattenItems(blocks: JsonLdBlock[]): Obj[] {
  const out: Obj[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!isObj(v)) return;
    if (Array.isArray(v["@graph"])) (v["@graph"] as unknown[]).forEach(visit);
    if (v["@type"]) out.push(v);
  };
  blocks.forEach((b) => b.data && visit(b.data));
  return out;
}

const LOCAL_BUSINESS_TYPES = new Set([
  "LocalBusiness", "Restaurant", "Store", "Dentist", "MedicalBusiness", "LegalService", "ProfessionalService",
  "HomeAndConstructionBusiness", "AutomotiveBusiness", "FoodEstablishment", "HealthAndBeautyBusiness", "LodgingBusiness",
  "FinancialService", "RealEstateAgent", "TravelAgency", "Hotel", "CafeOrCoffeeShop", "Bakery",
]);
const ARTICLE_TYPES = new Set(["Article", "NewsArticle", "BlogPosting", "TechArticle", "Report"]);

const has = (o: Obj, k: string) => o[k] !== undefined && o[k] !== null && o[k] !== "";

/**
 * Checks discovered items against the properties Google documents as required for
 * the corresponding rich result features. This is a focused property check, not a
 * full schema.org validator; it does not predict rich result eligibility.
 */
export function analyzeStructuredData(blocks: JsonLdBlock[], microdataTypes: string[]): StructuredDataSummary {
  const invalidBlocks = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.error)
    .map(({ b, i }) => ({ index: i + 1, error: b.error!, snippet: b.raw.slice(0, 160) }));
  const items = flattenItems(blocks);
  const issues: StructuredDataSummary["issues"] = [];

  for (const b of blocks) {
    if (!b.data) continue;
    const ctxs = asArray(b.data as Obj | Obj[]).map((d) => (isObj(d) ? d["@context"] : undefined));
    if (ctxs.some((c) => c === undefined)) issues.push({ type: "JSON-LD", message: "A JSON-LD block has no @context." });
    else if (ctxs.some((c) => typeof c === "string" && !/schema\.org/i.test(c)))
      issues.push({ type: "JSON-LD", message: "@context does not reference schema.org." });
  }

  for (const item of items) {
    for (const t of typesOf(item)) {
      if (t === "Organization" || t === "Corporation") {
        if (!has(item, "name")) issues.push({ type: t, message: "Organization is missing name." });
        if (!has(item, "url")) issues.push({ type: t, message: "Organization is missing url (recommended)." });
      } else if (LOCAL_BUSINESS_TYPES.has(t)) {
        if (!has(item, "name")) issues.push({ type: t, message: `${t} is missing name (required).` });
        if (!has(item, "address")) issues.push({ type: t, message: `${t} is missing address (required).` });
      } else if (ARTICLE_TYPES.has(t)) {
        if (!has(item, "headline")) issues.push({ type: t, message: `${t} is missing headline (recommended).` });
        if (!has(item, "author")) issues.push({ type: t, message: `${t} is missing author (recommended).` });
        if (!has(item, "datePublished")) issues.push({ type: t, message: `${t} is missing datePublished (recommended).` });
      } else if (t === "Product") {
        if (!has(item, "name")) issues.push({ type: t, message: "Product is missing name (required)." });
        if (!has(item, "offers") && !has(item, "review") && !has(item, "aggregateRating"))
          issues.push({ type: t, message: "Product needs one of offers, review or aggregateRating." });
      } else if (t === "FAQPage") {
        const qs = asArray(item.mainEntity as Obj | Obj[]);
        if (!qs.length) issues.push({ type: t, message: "FAQPage has no mainEntity questions." });
        qs.forEach((q, i) => {
          if (!isObj(q) || !typesOf(q).includes("Question")) issues.push({ type: t, message: `mainEntity[${i}] is not a Question.` });
          else {
            if (!has(q, "name")) issues.push({ type: t, message: `Question ${i + 1} is missing name.` });
            const a = q.acceptedAnswer as Obj | undefined;
            if (!isObj(a) || !has(a, "text")) issues.push({ type: t, message: `Question ${i + 1} is missing acceptedAnswer.text.` });
          }
        });
      } else if (t === "BreadcrumbList") {
        const els = asArray(item.itemListElement as Obj | Obj[]);
        if (!els.length) issues.push({ type: t, message: "BreadcrumbList has no itemListElement." });
        els.forEach((e, i) => {
          if (!isObj(e)) return;
          if (!has(e, "position")) issues.push({ type: t, message: `Breadcrumb item ${i + 1} is missing position.` });
          const named = has(e, "name") || (isObj(e.item) && has(e.item as Obj, "name"));
          if (!named) issues.push({ type: t, message: `Breadcrumb item ${i + 1} is missing name.` });
        });
      } else if (t === "HowTo") {
        if (!has(item, "step")) issues.push({ type: t, message: "HowTo is missing step." });
      }
    }
  }

  return {
    jsonLdBlocks: blocks.length,
    invalidBlocks,
    types: Array.from(new Set(items.flatMap(typesOf))),
    microdataTypes,
    issues,
    items: items.slice(0, 50).map((i) => ({ type: typesOf(i).join(", "), properties: Object.keys(i).filter((k) => !k.startsWith("@")).slice(0, 30) })),
  };
}

export function faqQuestions(blocks: JsonLdBlock[]): string[] {
  return flattenItems(blocks)
    .filter((i) => typesOf(i).includes("FAQPage"))
    .flatMap((i) => asArray(i.mainEntity as Obj | Obj[]))
    .filter(isObj)
    .map((q) => String(q.name || ""))
    .filter(Boolean);
}

export function orgNames(blocks: JsonLdBlock[]): string[] {
  return flattenItems(blocks)
    .filter((i) => typesOf(i).some((t) => t === "Organization" || t === "Corporation" || LOCAL_BUSINESS_TYPES.has(t) || t === "WebSite"))
    .map((i) => String(i.name || ""))
    .filter(Boolean);
}
