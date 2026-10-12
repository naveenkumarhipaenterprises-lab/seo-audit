# SearchScope AI

**Understand Your SEO. Improve Your AI Visibility.**

A working SEO + AEO (Answer Engine Optimization) + GEO (Generative Engine Optimization) audit tool. Enter a public URL and it performs real checks, streams real progress, calculates transparent scores, and produces downloadable PDF and CSV reports from the saved results.

Nothing is fabricated: data without a source (Google indexing status, search volume, rankings, backlinks, AI citations) is shown as *Not tested*, *Unavailable* or *Connect an account*.

## What the MVP does

| Area | Checks |
| --- | --- |
| HTTP & security | Status code, redirect chain, HTTPS, mixed content |
| Metadata | Title/description presence, length and duplicates on the page, Open Graph/Twitter, `lang` |
| Headings | H1 presence/multiples, empty, skipped levels, duplicates, full outline |
| Indexability | robots.txt (Googlebot), meta robots + `X-Robots-Tag`, canonical presence/conflicts/mismatch/target status, canonical–noindex conflict, XML sitemap discovery, validation and URL inclusion, hreflang |
| Structured data | JSON-LD syntax, Google-documented properties for Organization, LocalBusiness, Article, Product, FAQPage, BreadcrumbList, HowTo |
| Links | Internal/external counts, broken internal (and optionally external) links, empty anchors, nofollow |
| Images | Missing vs intentionally empty ALT, ALT quality, broken images, file size, format, intrinsic dimensions, width/height attributes, lazy loading; searchable/filterable table |
| Keyword & content | Placement in title, description, H1, H2/H3, URL, intro and body; density/stuffing; secondary keywords; content length |
| AEO | Question headings, direct answers, summary, definitions, step lists, comparison tables, sectioning, content-type schema, FAQ schema vs visible content, breadcrumbs; rule-based question suggestions |
| GEO | Entity markup, brand consistency, About/contact, author and dates (article pages), external references, specific facts, descriptive headings, search/answer crawler access, content available without JavaScript; per-token robots.txt table for 14 documented crawlers |
| Performance | Google PageSpeed Insights mobile + desktop: Lighthouse score, LCP, FCP, Speed Index, TBT, CLS (lab), CrUX field data incl. INP when it exists, opportunities |
| Mobile | Viewport, zoom, plus rendered checks in headless Chromium at 375/768/1366 px: horizontal overflow, small text, tap targets, wide images; srcset usage |

Single-page audit only. Multi-page crawling, duplicate detection across pages and orphan pages are Phase 2 and are reported as *Not tested*.

## Scoring

Defined in [`lib/scoring/weights.ts`](lib/scoring/weights.ts), applied in [`lib/scoring/score.ts`](lib/scoring/score.ts):

- Each check is worth points by severity: critical 10, high 6, medium 3, low 1. Pass = 100 %, warning = 50 %, fail = 0. Not applicable, info and not-tested checks are excluded from the denominator.
- Every check belongs to exactly one category, so no issue is penalised twice. Performance uses the Lighthouse score directly (mean of tested strategies).
- **SEO** = Technical 40 + Content 15 + Images 10 + Performance 20 + Mobile 15 (normalised over tested components).
- **Overall** = SEO 50 % + AEO 25 % + GEO 25 %; weights of untested components are redistributed and the report is marked partial.
- The methodology version is stored with every audit; scores are reproducible from the stored checks. The score is this tool's diagnostic model, not an official Google/ChatGPT score.

## Security

- URL validation: http/https only, no credentials, ports 80/443/8080/8443, no local/internal hostnames, no private/loopback/link-local/CGNAT/metadata/multicast/reserved IPs (IPv4, IPv6, IPv4-mapped, NAT64, 6to4).
- SSRF: every hostname is resolved and **all** addresses checked; the socket connects through a guarded DNS lookup so the validated address is the one used (defeats DNS rebinding). Redirects are followed manually and every hop is re-validated. Timeouts, decoded-size caps (zip-bomb safe), redirect limits.
- Headless Chromium: every sub-request is intercepted and re-validated, WebSockets/service workers/media blocked; crawled scripts never run in the app origin.
- Rate limit (per IP) and concurrency cap on audits; input validated with zod; CSP and security headers; crawled text is rendered as escaped text only and images are linked, not loaded; CSV formula-injection guard; no raw HTML is stored.
- Optional `APP_PASSWORD` basic-auth gate over every page and API route (use it for any deployment until accounts exist).

## Local setup

Requirements: Node.js ≥ 22.19.

```bash
npm install
cp .env.example .env.local      # optional; everything works without keys
npm run dev                     # http://localhost:3000
```

Optional extras:

- **PageSpeed key** (free, recommended): Google Cloud console → enable *PageSpeed Insights API* → create an API key → `PAGESPEED_API_KEY`. Without it, Google's shared keyless quota is used and often returns HTTP 429, which shows as *Not tested*.
- **Rendering**: install Chrome/Chromium and set `CHROMIUM_PATH` (or `npx playwright install chromium` then `ENABLE_BROWSER_RENDERING=1`).

## Testing

```bash
npm run check                   # eslint + tsc + vitest (unit and fixture integration tests)
npm run build && npm start      # production server
BASE_URL=http://localhost:3000 AUDIT_URL=https://example.com CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

The e2e smoke test drives the real UI: starts an audit, verifies progress only moves forward with intermediate states, opens the report, downloads the PDF and CSV and checks their contents, clicks every tab, and checks for horizontal overflow and the navigation drawer at 375/768/1366 px. Fixture data is used only in automated tests and never shown as live data.

## Deployment

**Vercel**: import the repo, set env vars (at least `APP_PASSWORD`, and `PAGESPEED_API_KEY`). Notes:
- `/api/audit` declares `maxDuration = 120`; PageSpeed runs can take 20–60 s. Hobby plans may cap function duration lower.
- Vercel's file system is ephemeral: audits stored in `/tmp` disappear between instances, so history is not durable there until the Supabase adapter (Phase 2). Rate limits are per instance.
- Headless Chromium is not available on Vercel by default; rendered checks show *Not tested*.

**Node host / container (recommended for the MVP)**: any VM, Render, Railway, Fly.io or Docker with a persistent volume for `AUDIT_DATA_DIR` and Chromium installed. `npm ci && npm run build && npm start`.

For larger audits (Phase 2 crawler), run crawls in a queue/worker (e.g. a separate worker process with a Postgres or Redis queue) rather than inside a request.

## Supabase (Phase 2)

Schema with RLS for users, projects, websites, audits, crawled pages, checks (SEO/AEO/GEO findings), images, performance measurements, report metadata and encrypted-credential references: [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). Apply with `supabase link` + `supabase db push`, or paste into the SQL editor. Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.

## External services and costs

| Service | Needed for | Cost |
| --- | --- | --- |
| Google PageSpeed Insights API | Performance scores | Free (quota-limited; key recommended) |
| Google Search Console API (Phase 2) | Verified indexing via URL Inspection | Free; requires OAuth and property ownership; ~2,000 inspections/day/property |
| Supabase (Phase 2) | Persistence, auth | Free tier; paid from ~$25/month |
| AI provider (Phase 3) | Optional suggestions | Paid per token; disabled by default |
| Keyword data provider (future) | Volume, difficulty, rankings | Paid (e.g. DataForSEO, Semrush) |

## Known limitations

- Single page per audit; link and image checks are capped (50 links, 40 images).
- Google indexing is never inferred from 200/sitemap/canonical; it needs Search Console.
- AI crawler results reflect robots.txt only (not CDN/WAF rules or actual inclusion). AI visibility is not measured.
- AEO/GEO checks are structural heuristics and are labelled as such; they do not judge factual accuracy.
- Timeouts/refused connections on links and images are reported as *unverified*, not broken.

## Roadmap

- **Phase 2**: multi-page crawler with queue, Supabase persistence + Auth + RLS, Search Console OAuth + URL Inspection, shareable report links with access control.
- **Phase 3**: AI recommendations via a server-side provider adapter (untrusted page content isolated from instructions, outputs labelled AI-generated), competitor comparisons, verified AI visibility tracking via documented data sources, billing.
