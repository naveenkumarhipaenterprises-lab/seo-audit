-- Audit platform v2 fields (engine 2.0.0). Additive only; existing rows are unchanged.
-- Not used by the default file-based store yet.

alter type public.audit_status add value if not exists 'completed';
alter type public.audit_status add value if not exists 'completed_with_warnings';

alter table public.audits
  add column if not exists engine_version text,
  add column if not exists mode text not null default 'quick' check (mode in ('quick', 'full')),
  add column if not exists tasks jsonb not null default '[]',          -- stage and external task statuses
  add column if not exists crawl_summary jsonb,                         -- limits, discovered/processed counts, stop reason
  add column if not exists failure jsonb,                               -- { stage, message } for failed or cancelled audits
  add column if not exists warnings text[] not null default '{}',
  add column if not exists issue_states jsonb not null default '{}',    -- check id -> open | ignored | not_applicable
  add column if not exists started_at timestamptz;

alter table public.crawled_pages
  add column if not exists final_url text,
  add column if not exists found_via text check (found_via in ('start', 'link', 'sitemap')),
  add column if not exists indexable boolean,                           -- indexability signals only, not Google's index
  add column if not exists content_hash text,
  add column if not exists inlinks integer,
  add column if not exists issues text[] not null default '{}',
  add column if not exists error text;

alter table public.audit_checks
  add column if not exists source text check (source in ('observed', 'external', 'assessment')),
  add column if not exists affected_urls text[] not null default '{}',
  add column if not exists detected_at timestamptz;

alter table public.audit_checks drop constraint if exists audit_checks_category_check;
alter table public.audit_checks add constraint audit_checks_category_check
  check (category in ('technical', 'onpage', 'content', 'images', 'aeo', 'geo', 'performance', 'mobile', 'accessibility', 'security'));
