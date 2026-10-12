-- SearchScope AI schema (Phase 2). Not used by the MVP, which stores audits on the
-- server file system. Apply with `supabase db push` or the SQL editor.
-- Every user-owned table has Row Level Security; the service-role key must only be
-- used server-side and never shipped to the browser.

create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.websites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  root_url text not null,
  created_at timestamptz not null default now(),
  unique (project_id, root_url)
);

create type public.audit_status as enum ('queued', 'running', 'complete', 'partial', 'failed', 'cancelled');

create table public.audits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  website_id uuid references public.websites (id) on delete set null,
  requested_url text not null,
  final_url text,
  status public.audit_status not null default 'queued',
  methodology_version text not null,
  input jsonb not null,                 -- keywords, toggles
  crawl_limits jsonb not null,          -- max pages, depth, links checked
  scores jsonb,                         -- full Scores object (reproducible from checks)
  overall_score smallint,
  seo_score smallint,
  aeo_score smallint,
  geo_score smallint,
  performance_score smallint,
  limitations text[] not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz                -- retention
);
create index audits_owner_created on public.audits (owner_id, created_at desc);

create table public.crawled_pages (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  http_status smallint,
  redirects jsonb not null default '[]',
  page_summary jsonb,                   -- extracted metadata only; raw HTML is never stored
  response_time_ms integer,
  html_bytes integer,
  depth smallint not null default 0,
  unique (audit_id, url)
);

create type public.check_status as enum ('pass', 'warning', 'fail', 'info', 'not_applicable', 'not_tested');
create type public.check_severity as enum ('critical', 'high', 'medium', 'low');

-- Covers SEO issues, AEO findings and GEO findings (distinguished by category).
create table public.audit_checks (
  id bigint generated always as identity primary key,
  audit_id uuid not null references public.audits (id) on delete cascade,
  page_id uuid references public.crawled_pages (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  check_id text not null,
  category text not null check (category in ('technical', 'content', 'images', 'aeo', 'geo', 'performance', 'mobile')),
  grp text not null,
  title text not null,
  status public.check_status not null,
  severity public.check_severity not null,
  affected_url text not null,
  evidence text[] not null default '{}',
  explanation text not null,
  recommendation text not null,
  detection text not null,
  limitation text,
  measured_score smallint
);
create index audit_checks_audit on public.audit_checks (audit_id, category);

create table public.images (
  id bigint generated always as identity primary key,
  audit_id uuid not null references public.audits (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  src text not null,
  source_page text not null,
  alt text,
  alt_state text not null check (alt_state in ('present', 'empty', 'missing')),
  probe jsonb
);

create table public.performance_measurements (
  id bigint generated always as identity primary key,
  audit_id uuid not null references public.audits (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  strategy text not null check (strategy in ('mobile', 'desktop')),
  status text not null,
  score smallint,
  lab jsonb,
  field jsonb,                          -- CrUX data with source ('url' | 'origin' | 'none')
  opportunities jsonb,
  lighthouse_version text,
  measured_at timestamptz
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  format text not null check (format in ('pdf', 'csv')),
  storage_path text,                    -- Supabase Storage object in a private bucket
  bytes integer,
  partial boolean not null default false,
  created_at timestamptz not null default now()
);

-- Integration credentials are stored encrypted (e.g. via Supabase Vault); this table
-- only holds a reference, never the plaintext token.
create table public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google_search_console', 'ai_provider', 'keyword_provider')),
  vault_secret_id uuid not null,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (owner_id, provider)
);

-- Row Level Security: owners only.
do $$
declare t text;
begin
  foreach t in array array['projects','websites','audits','crawled_pages','audit_checks','images','performance_measurements','reports','integration_credentials'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_owner', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());

-- Retention: run daily (pg_cron) to delete expired audits; cascades remove child rows.
-- select cron.schedule('purge-expired-audits', '0 3 * * *', $$delete from public.audits where expires_at < now()$$);
