-- "priority": a lead the team flagged for Daksh to look at (the dashboard's Priority tab).
alter table public.pipeline_leads drop constraint if exists pipeline_leads_stage_check;
alter table public.pipeline_leads
  add constraint pipeline_leads_stage_check
  check (stage in ('new', 'priority', 'applied', 'talking', 'won', 'lost', 'passed'));
