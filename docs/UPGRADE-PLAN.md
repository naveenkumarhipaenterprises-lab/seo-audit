# Advanced platform upgrade: implementation plan

Based on inspecting the MVP on `main` (Next.js 16 App Router, TypeScript, Tailwind 4, undici + cheerio audit engine,
PDFKit, file-based store, Vitest). The MVP already does real single-page checks with SSRF protection, deterministic
scoring and PDF/CSV. Nothing in it is mocked; the gaps are scope, not fake data.

## Found during inspection
- Single-page only: duplicate metadata/content and orphan checks are `not_tested`; "Max pages / depth" is a disabled placeholder.
- Progress is a modal tied to one streaming HTTP request: it disappears when you navigate and cancels if the tab closes.
- 13 stages, statuses `complete | partial | failed` only; failed audits are not recorded.
- Competitor URLs are stored but unused; AI and subdomain switches are disabled placeholders.
- PSI requests only the performance category; no INP; no per-strategy preference or retry.
- No accessibility or security-header checks, no provenance labels, no audit-to-audit issue diff, no per-user report scoping.
- README lacks Windows steps.

## Changes (kept inside the existing architecture)
1. **Audit jobs**: in-process job registry; `POST /api/audit` starts a job and returns its id; the client polls
   `GET /api/audit/jobs/:id`; `POST …/cancel` cancels. A global progress panel in the app shell survives navigation and refresh.
2. **14 real stages** (validate, connect, fetch, discover robots/sitemap, crawl, technical, metadata/content, images/links,
   structured data, AEO, GEO, performance, scoring, report), filtered by mode; queued/running/completed/skipped/failed;
   pages discovered/processed/remaining; "Estimated time unavailable"; final status Completed / Completed with warnings /
   Partially completed / Failed / Cancelled (failures and cancellations are recorded in history).
3. **Full Site Audit**: bounded BFS crawler (same host, robots-aware, max pages ≤ 100, depth ≤ 5, concurrency 3,
   time budget, dedupe + normalisation, loop prevention) seeded from links and sitemap URLs; page inventory;
   site-level checks (duplicate titles/descriptions/content, thin pages, broken internal links, internal redirects,
   non-indexable pages, orphan candidates only when the crawl was complete).
4. **New check categories**: On-page SEO (split from technical), Accessibility & HTML structure, Security headers;
   X-Robots-Tag, charset, URL structure, HTTP→HTTPS redirect, readability, repetition, freshness, filename signals,
   business name/location/type consistency.
5. **Provenance** on every finding: observed / external / assessment, plus affected URLs and detection time.
6. **Scoring v2**: severity 10/5/2/1 per the brief, separate scores per category, Overall = SEO 45 + AEO 20 + GEO 20 +
   Accessibility 10 + Security 5 (renormalised over tested parts), counts of tested/passed/failed/skipped/NA and pages analysed.
7. **PSI**: all four Lighthouse categories, INP/LCP/CLS field data, strategy preference, retry endpoint, short cache with timestamps.
8. **Competitors**: single-page snapshot of each competitor using the same check modules (actually fetched data only).
9. **Search Console (optional)**: OAuth connect, property match, Search Analytics totals and top queries, URL Inspection;
   tokens encrypted at rest; "Not verified through Search Console" when not connected.
10. **Issues**: filters (All/Critical/High/Medium/Low/Fixed/Skipped), Open/Ignored/Not applicable state per audit,
    Fixed derived from comparison with the previous real audit (new/resolved/unchanged issues, pages added/removed).
11. **Access control**: per-browser owner cookie; reports, history and exports only visible to their owner.
12. **Reports**: PDF gains config, pages analysed, counts, accessibility/security, inventory, competitors, GSC, sources;
    CSV gains source, affected URLs, issue state and the page inventory.
13. **Docs/tests**: Windows run steps, env vars, tests for crawler, jobs, cancellation, statuses, access control, new checks.
