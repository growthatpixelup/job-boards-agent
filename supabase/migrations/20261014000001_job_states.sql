-- One row per job the AI layer has kept (qualified or maybe) in some run, holding its newest verdict. The dashboard
-- reads this small table instead of every run's full JSON, which grew by ~190 KB per scrape.
create table if not exists public.job_states (
  id text primary key, -- Contra job id
  url text not null,
  job jsonb not null, -- the newest ClassifiedJob seen
  first_seen_at timestamptz not null, -- first run that had the job
  last_seen_at timestamptz not null, -- last run that had it, or that rejected it
  rejected boolean not null default false -- the newest run rejected it
);
create index if not exists job_states_url_idx on public.job_states (url);
alter table public.job_states enable row level security;
