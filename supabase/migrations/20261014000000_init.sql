-- Contra scraper state, moved out of data/*.json.
-- Every table has RLS on and no policies: only the service role key (server and scraper) can read or write.
-- The publishable key gets nothing.

-- One row per scrape. `data` is the whole RunResult (what data/runs/*.json held); the newest row is "latest".
create table if not exists public.runs (
  ran_at timestamptz primary key,
  preset text not null,
  daily boolean not null default false, -- the scheduled daily scrape; the workflow gate looks for one per SF day
  data jsonb not null
);

-- Jobs the scraper has already seen (was data/seen-ids.json).
create table if not exists public.seen_jobs (
  id text primary key,
  created_at timestamptz not null default now()
);

-- Jobs already posted to Slack (was data/announced-ids.json).
create table if not exists public.announced_jobs (
  id text primary key,
  created_at timestamptz not null default now()
);

-- The stage the team moved each lead to (was data/pipeline.json). id is the Contra job id.
create table if not exists public.pipeline_leads (
  id text primary key,
  title text not null,
  stage text not null check (stage in ('new', 'applied', 'talking', 'won', 'lost', 'passed')),
  updated_at timestamptz not null default now()
);

alter table public.runs enable row level security;
alter table public.seen_jobs enable row level security;
alter table public.announced_jobs enable row level security;
alter table public.pipeline_leads enable row level security;
