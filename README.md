# SearchScope AI

**Understand Your SEO. Improve Your AI Visibility.**

A website audit platform for SEO, AEO (Answer Engine Optimization) and GEO (Generative Engine Optimization). Enter a public URL and it makes real requests, runs real checks, shows real progress, calculates transparent scores and produces PDF and CSV reports from the saved results.

Nothing is fabricated. Data without a source (Google indexing status, search volume, rankings, backlinks, AI citations, field data Google does not have) is shown as *Not tested*, *Unavailable*, *No field data available* or *Not verified through Search Console*.

## What it does

**Two audit modes**

| Mode | What runs |
| --- | --- |
| Quick Audit | The submitted page: technical, on-page, content, images, links, structured data, accessibility, security headers, AEO, GEO, optional PageSpeed and rendering. Often 15–90 s, depending on the site and Google's API. |
| Full Site Audit | Everything above, plus a same-site crawl (2–100 pages, depth 1–5, robots.txt respected, sitemap URLs used as seeds) with site-wide findings: duplicate titles/descriptions/content, thin pages, broken internal links, redirect chains, noindex and canonical conflicts, sitemap URL validity, orphan candidates (only when the crawl was complete), slow pages, and a page inventory. Often 1–5 min for a small site; larger crawls take longer. |

Timings are estimates, not guarantees. The progress dialog shows the real stage (14 stages, filtered by mode), pages discovered / processed / remaining, elapsed time and *Estimated time unavailable* instead of a countdown. Audits run as background jobs: you can navigate or reload and the progress comes back, minimise it to a dock, or cancel it. Final statuses are *Completed*, *Completed with warnings*, *Partially completed*, *Failed* and *Cancelled*. A failed PageSpeed call never discards the other results, and the report has a *Retry performance test* button.

**Checks** (each finding records its evidence, severity, explanation, recommended fix, detection method, limitation, affected URLs, detection time and its source)

| Area | Examples |
| --- | --- |
| Technical SEO | HTTP status, redirect chains and loops, HTTPS, mixed content, robots.txt, XML sitemaps, meta robots and `X-Robots-Tag`, canonical conflicts, hreflang, broken internal/external links |
| On-page SEO | Title and description presence, length and duplicates, headings, Open Graph, `lang`, charset, viewport |
| Keywords & Content | On-page keyword analysis (placement, density, secondary keywords), content length, topic match of title and H1, readability (English), repeated phrases, anchor text, internal linking |
| Images | Missing vs intentionally empty ALT, ALT quality and repetition, file names, broken images, size, format, dimensions, width/height, lazy loading, srcset. Filterable table with page URL, issue and suggested fix |
| Accessibility | Main landmark, duplicate IDs, form labels, button names, iframe titles, positive tabindex, autoplay, skip link, Lighthouse accessibility score when PageSpeed runs |
| Security | HTTP → HTTPS redirect, HSTS, CSP, clickjacking, nosniff, Referrer-Policy, cookie flags, version disclosure (a limited public check, not a security assessment) |
| AEO readiness | Question headings, direct answers, definitions, lists and tables, FAQ markup vs visible content, schema relevance |
| GEO readiness | Entity markup, brand consistency, business name/location/type you enter, contact consistency across crawled pages, authorship, references, unsupported claims, AI crawler access per robots.txt |
| Performance | PageSpeed Insights (mobile, desktop or both): Lighthouse Performance, Accessibility, Best Practices and SEO scores, LCP, FCP, CLS, TBT, Speed Index, opportunities, and Chrome UX Report field data (including INP) only when Google returns it |
| Competitors | Up to 3 competitor home pages fetched once and scored with the same reduced check set as your page, side by side. No traffic or ranking estimates |
| Search Console (optional) | Clicks, impressions, CTR, average position, top queries and URL Inspection for a property your Google account is verified for |

Each finding is labelled **Observed** (measured from fetched pages and headers), **External** (returned by a Google API) or **Assessment** (this tool's judgement from page signals).

**Reports**: dashboard tabs Overview, Technical SEO, Images, Keywords & Content, AEO, GEO, Performance & Mobile, Pages (Full Site) and Methodology. The Overview has a prioritised issue list with filters (All, Critical, High, Medium, Low, Fixed, Skipped or unavailable, Ignored/N/A), per-issue status (Open, Ignored, Not applicable; scores are not changed), and a comparison with the previous real audit of the same URL (new, resolved and unchanged issues, score changes, pages added and removed). PDF (20 sections, page numbers, partial reports marked) and CSV (every finding, image and crawled page) are generated from the stored audit.

## Scoring

Defined in [`lib/scoring/weights.ts`](lib/scoring/weights.ts) and applied in [`lib/scoring/score.ts`](lib/scoring/score.ts). Methodology version `2026.10-v2` is stored with every audit.

- Each check is worth points by severity: critical 10, high 5, medium 2, low 1. Pass earns 100 %, warning 50 %, fail 0. Not applicable, informational and skipped checks are excluded, so missing data never counts as a pass or a failure.
- Every check belongs to exactly one category, so an issue is not penalised twice. Site-wide checks replace their single-page equivalents in Full Site mode.
- **SEO** = Technical 30 + On-page 15 + Content 15 + Images 10 + Performance 20 + Mobile 10.
- **Overall audit health** = SEO 45 + AEO 20 + GEO 20 + Accessibility 10 + Security 5.
- Weights are renormalised over the parts that were tested. The report shows tested, passed, failed, warning, skipped and not-applicable counts and the number of pages analysed.

These are this tool's diagnostic scores, not official Google scores, and improving them does not guarantee rankings, traffic or AI citations.

## Security

- URL validation: http/https only, no credentials, ports 80/443/8080/8443, no local/internal hostnames, no private, loopback, link-local, CGNAT, metadata, multicast or reserved IPs (IPv4, IPv6, IPv4-mapped, NAT64, 6to4).
- SSRF: every hostname is resolved and all addresses are checked; the socket connects through a guarded DNS lookup so the validated address is the one used (defeats DNS rebinding). Redirects are followed manually and every hop is re-validated. Timeouts, decoded-size caps, redirect limits, content-type checks.
- Crawler limits: same registrable domain only, max 100 pages, depth 5, 3 concurrent requests, a time budget, URL normalisation, deduplication and crawl-trap filters. robots.txt is respected by default.
- Headless Chromium (optional) intercepts and re-validates every sub-request and blocks WebSockets and service workers. Crawled scripts never run in the app.
- Crawled content is treated as data: it is stored as extracted text, rendered escaped, and images are linked, not loaded. No raw HTML is stored. CSV formula injection is neutralised.
- Report access: every browser gets a random HttpOnly owner cookie; reports, history, jobs, exports and Search Console tokens are only visible to that browser. Set `AUDIT_SHARED_HISTORY=1` only for a team deployment behind `APP_PASSWORD`.
- Rate limit per IP, concurrency cap, zod input validation, CSP and security headers, structured JSON logs without credentials. API keys and OAuth secrets are read on the server only and never reach the browser bundle.
- Optional `APP_PASSWORD` basic-auth gate over every page and API route. Use it for any public deployment.

## Run it locally

Requirements: **Node.js 22.19 or newer** (check with `node -v`) and Git.

### Windows (PowerShell)

Run every command from inside the project folder (the one that contains `package.json`). Running `npm` from another folder is the most common cause of *Could not read package.json*.

```powershell
git clone https://github.com/naveenkumarhipaenterprises-lab/seo-audit.git
cd seo-audit
npm ci
copy .env.example .env.local     # optional: edit .env.local in Notepad to add keys
npm run dev
```

Open http://localhost:3000. Stop the server with `Ctrl+C`.

If you already cloned it earlier, update instead:

```powershell
cd seo-audit
git pull
npm ci
npm run dev
```

To set a variable for one session instead of `.env.local`: `$env:PAGESPEED_API_KEY="your-key"; npm run dev`.

### macOS / Linux

```bash
git clone https://github.com/naveenkumarhipaenterprises-lab/seo-audit.git
cd seo-audit
npm ci
cp .env.example .env.local   # optional
npm run dev
```

### Production build

```bash
npm run build
npm start                    # http://localhost:3000 (set PORT to change)
```

## Configuration

Copy `.env.example` to `.env.local` and fill in only what you need. Never commit `.env.local`; it is git-ignored.

**Works with no keys at all**: Quick and Full Site audits, every technical, on-page, content, image, link, structured-data, accessibility, security, AEO and GEO check, competitors, history, comparison, PDF and CSV.

| Feature | Variables | Cost |
| --- | --- | --- |
| PageSpeed Insights (performance, Lighthouse categories, field data) | `PAGESPEED_API_KEY` (recommended). Without it Google's shared keyless quota is used and often returns HTTP 429, shown as *Not tested* with a retry button | Free. Google Cloud console → enable *PageSpeed Insights API* → Credentials → API key. Restrict the key to that API |
| JavaScript rendering and responsive checks | `CHROMIUM_PATH` to a Chrome/Chromium binary, or `ENABLE_BROWSER_RENDERING=1` after `npx playwright install chromium`. `CHROMIUM_NO_SANDBOX=1` only for root containers | Free |
| Google Search Console | `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REDIRECT_URI`, `GSC_TOKEN_SECRET` (32+ random characters), optional `GSC_TOKEN_DIR` | Free; see below |
| Access gate | `APP_PASSWORD`, `APP_USERNAME` | — |
| Storage and limits | `AUDIT_DATA_DIR`, `AUDIT_RETENTION_DAYS`, `MAX_CONCURRENT_AUDITS`, `AUDIT_RATE_LIMIT`, `CRAWL_TIME_BUDGET_MS`, `CRAWLER_USER_AGENT`, `AUDIT_SHARED_HISTORY` | — |

No paid service is used. Keyword volume, rankings, backlinks and AI visibility need a paid data provider and are not connected; those fields say so.

### Search Console setup

1. In Google Cloud console create a project, enable the **Google Search Console API**, configure the OAuth consent screen (External, add yourself as a test user) and create an **OAuth client ID** of type *Web application*.
2. Add the authorised redirect URI `http://localhost:3000/api/gsc/callback` (and your production URL's `/api/gsc/callback`).
3. Set `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REDIRECT_URI` (the same URI) and `GSC_TOKEN_SECRET` (generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
4. Restart, open **Settings → Google Search Console → Connect**, and approve read-only access. Then tick *Use Google Search Console* when starting an audit.

Data is only returned for properties your Google account is verified for. Entering a URL does not grant access to anyone else's data. The refresh token is encrypted (AES-256-GCM) in `GSC_TOKEN_DIR` (default `.data/gsc`) and can be removed with *Disconnect*.

## Testing

```bash
npm run lint
npm run typecheck
npm test                      # vitest: unit and fixture-based integration tests
npm run check                 # all three
```

End-to-end (needs a running server and a Chrome/Chromium binary):

```bash
npm run build && npm start
BASE_URL=http://localhost:3000 AUDIT_URL=https://example.com CHROMIUM_PATH=/path/to/chrome npm run test:e2e
MODE=full MAX_PAGES=6 BASE_URL=... AUDIT_URL=... CHROMIUM_PATH=... npm run test:e2e   # Full Site mode
```

The e2e test starts an audit in the real UI, checks progress only moves forward, minimises it, reloads another page and checks the progress dock comes back, opens the report, downloads the PDF and CSV and checks their contents, clicks every tab, cancels a second audit, checks a different browser gets 404 for the report and its PDF, and checks layouts at 375, 768 and 1366 px. Fixture data is used only in automated tests and never shown as live data.

## Deployment

Audits run as in-process background jobs, so use **one long-running Node process** (a VM, Render, Railway, Fly.io or Docker) with a persistent volume for `AUDIT_DATA_DIR` and `GSC_TOKEN_DIR`:

```bash
npm ci && npm run build && npm start
```

Set at least `APP_PASSWORD` and `PAGESPEED_API_KEY` for a public deployment, and keep the default rate limits.

**Vercel / serverless** is not recommended for this version: a job keeps running after the request that started it returns, which serverless platforms do not guarantee, the file system is ephemeral, and rate limits and jobs are per instance. Running several instances behind a load balancer needs a shared job queue and database (the Supabase schema in [`supabase/migrations`](supabase/migrations) is prepared for this but not wired in yet).

No background worker or database migration is needed for the default file-based storage.

## Known limitations

- Jobs live in the server process: restarting the server loses running audits (the browser shows *job lost*); finished audits are saved to disk.
- Full Site crawls are capped at 100 pages and use the static HTML only; links added by JavaScript are not followed.
- Google indexing status is never inferred from HTTP 200, sitemaps or canonicals. It needs Search Console.
- AI crawler results reflect robots.txt only, not CDN/WAF rules. AI visibility and citations are not measured.
- AEO and GEO checks are structural assessments; they do not judge factual accuracy.
- Timeouts and refused connections on links and images are reported as *unverified*, not broken.
- Security checks cover public response headers and redirects only.
- Image previews are not loaded into the dashboard, to avoid fetching third-party content into the viewer's browser.
- Per-browser ownership is not user accounts: clearing cookies or switching browsers hides earlier reports (they stay on the server until retention removes them).
