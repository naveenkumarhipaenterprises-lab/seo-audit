import robotsParser from "robots-parser";
import type { RobotsSummary } from "./types";
import { CRAWLER_TOKEN, LIMITS } from "../config";
import type { Fetcher } from "./fetcher";

/**
 * Crawler tokens documented by their operators. "allowed" in the report only means
 * the site's robots.txt rules permit that token for the audited URL; it says nothing
 * about firewalls, whether the operator honours robots.txt for every fetch type, or
 * whether content is used or cited.
 */
export const KNOWN_CRAWLERS = [
  { agent: "Googlebot", operator: "Google", purpose: "Google Search crawling" },
  { agent: "Google-Extended", operator: "Google", purpose: "Control token for Gemini model training/grounding use (not a separate crawler)" },
  { agent: "Bingbot", operator: "Microsoft", purpose: "Bing Search crawling (also used by Copilot answers)" },
  { agent: "GPTBot", operator: "OpenAI", purpose: "Model training crawler" },
  { agent: "OAI-SearchBot", operator: "OpenAI", purpose: "ChatGPT search index" },
  { agent: "ChatGPT-User", operator: "OpenAI", purpose: "User-initiated fetches (operator states robots.txt may not apply)" },
  { agent: "ClaudeBot", operator: "Anthropic", purpose: "Model training crawler" },
  { agent: "Claude-SearchBot", operator: "Anthropic", purpose: "Search result quality crawler" },
  { agent: "Claude-User", operator: "Anthropic", purpose: "User-initiated fetches" },
  { agent: "PerplexityBot", operator: "Perplexity", purpose: "Perplexity search index" },
  { agent: "Perplexity-User", operator: "Perplexity", purpose: "User-initiated fetches (operator states robots.txt generally not applied)" },
  { agent: "Applebot-Extended", operator: "Apple", purpose: "Control token for Apple AI training use" },
  { agent: "CCBot", operator: "Common Crawl", purpose: "Open web corpus used by many AI datasets" },
  { agent: "meta-externalagent", operator: "Meta", purpose: "AI training and product crawler" },
] as const;

export interface RobotsContext {
  summary: RobotsSummary;
  isAllowed: (url: string, agent: string) => boolean | null;
  hasGroupFor: (agent: string) => boolean;
}

export async function fetchRobots(pageUrl: string, fetcher: Fetcher, signal?: AbortSignal): Promise<RobotsContext> {
  const origin = new URL(pageUrl).origin;
  const robotsUrl = `${origin}/robots.txt`;
  const empty = (summary: RobotsSummary, allowAll: boolean | null): RobotsContext => ({
    summary,
    isAllowed: () => allowAll,
    hasGroupFor: () => false,
  });
  try {
    const res = await fetcher.fetch(robotsUrl, { maxBytes: LIMITS.maxRobotsBytes, timeoutMs: LIMITS.subresourceTimeoutMs, accept: "text/plain,*/*", signal });
    if (res.status >= 400 && res.status < 500) {
      // Google treats 4xx robots.txt as "no restrictions".
      return empty({ status: "missing", url: robotsUrl, httpStatus: res.status, allowedForCrawler: true, allowedForGooglebot: true, sitemaps: [] }, true);
    }
    if (res.status >= 500) {
      return empty(
        { status: "error", url: robotsUrl, httpStatus: res.status, allowedForCrawler: null, allowedForGooglebot: null, sitemaps: [], error: `robots.txt returned HTTP ${res.status}; Google may temporarily treat the site as fully disallowed.` },
        null,
      );
    }
    const text = res.body.toString("utf8");
    const parser = robotsParser(robotsUrl, text);
    const isAllowed = (url: string, agent: string) => {
      const v = parser.isAllowed(url, agent);
      return v === undefined ? null : v;
    };
    const groups = new Set(
      Array.from(text.matchAll(/^\s*user-agent\s*:\s*([^\s#]+)/gim)).map((m) => m[1].toLowerCase()),
    );
    return {
      summary: {
        status: "ok",
        url: robotsUrl,
        httpStatus: res.status,
        allowedForCrawler: isAllowed(pageUrl, CRAWLER_TOKEN),
        allowedForGooglebot: isAllowed(pageUrl, "Googlebot"),
        sitemaps: parser.getSitemaps().slice(0, 10),
        excerpt: text.slice(0, 2000),
      },
      isAllowed,
      hasGroupFor: (agent) => groups.has(agent.toLowerCase()),
    };
  } catch (e) {
    return empty(
      { status: "error", url: robotsUrl, httpStatus: null, allowedForCrawler: null, allowedForGooglebot: null, sitemaps: [], error: (e as Error).message },
      null,
    );
  }
}
