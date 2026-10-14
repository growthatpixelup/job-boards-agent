-- "closed": the job finished on Contra (closed or expired); set by the dashboard's local Contra sync.
alter table public.pipeline_leads drop constraint if exists pipeline_leads_stage_check;
alter table public.pipeline_leads
  add constraint pipeline_leads_stage_check
  check (stage in ('new', 'priority', 'applied', 'talking', 'won', 'lost', 'passed', 'closed'));
