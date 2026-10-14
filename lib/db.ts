import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RunResult } from "../scraper/types.ts";
import { applyRun, type JobState } from "./pipeline.ts";

// Where the scraper's state lives (supabase/migrations/): runs, seen and announced job ids, and the stages the
// dashboard saves. Everything goes through the service role key, server-side only; the tables have RLS on and no
// policies, so the publishable key can't touch them.

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Supabase: ${what} failed: ${res.error.message}`);
  return res.data as T;
}

const PAGE = 1000; // PostgREST returns at most this many rows per request

/** Every row of a table's column, paged. */
async function selectAll<T>(table: string, columns: string, order: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = check(await db().from(table).select(columns).order(order).range(from, from + PAGE - 1), `reading ${table}`) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export async function loadLatestRun(): Promise<RunResult | null> {
  const rows = check(await db().from("runs").select("data").order("ran_at", { ascending: false }).limit(1), "reading the latest run");
  return (rows[0]?.data as RunResult | undefined) ?? null;
}

export async function latestRanAt(): Promise<string | null> {
  const rows = check(await db().from("runs").select("ran_at").order("ran_at", { ascending: false }).limit(1), "reading the latest run time");
  return rows[0] ? new Date(rows[0].ran_at as string).toISOString() : null;
}

interface JobStateRow {
  id: string;
  url: string;
  job: JobState["job"];
  first_seen_at: string;
  last_seen_at: string;
  rejected: boolean;
}

const iso = (t: string) => new Date(t).toISOString();

const fromRow = (r: JobStateRow): JobState => ({
  id: r.id,
  url: r.url,
  job: r.job,
  firstSeenAt: iso(r.first_seen_at),
  lastSeenAt: iso(r.last_seen_at),
  rejected: r.rejected,
});

export async function loadJobStates(): Promise<JobState[]> {
  return (await selectAll<JobStateRow>("job_states", "id,url,job,first_seen_at,last_seen_at,rejected", "id")).map(fromRow);
}

/** Folds the run into job_states (see applyRun). Safe to repeat for the same run. */
async function saveJobStates(run: RunResult): Promise<void> {
  const states = new Map<string, JobState>();
  const keep = (rows: JobStateRow[]) => rows.forEach((r) => states.set(r.id, fromRow(r)));
  const cols = "id,url,job,first_seen_at,last_seen_at,rejected";
  const ids = run.jobs.map((j) => j.id);
  const urls = (run.rejected ?? []).map((r) => r.url);
  for (let i = 0; i < ids.length; i += 100) keep(check(await db().from("job_states").select(cols).in("id", ids.slice(i, i + 100)), "reading job_states") as JobStateRow[]);
  for (let i = 0; i < urls.length; i += 50) keep(check(await db().from("job_states").select(cols).in("url", urls.slice(i, i + 50)), "reading job_states") as JobStateRow[]);

  const rows = applyRun(states, run).map((st) => ({
    id: st.id,
    url: st.url,
    job: st.job,
    first_seen_at: st.firstSeenAt,
    last_seen_at: st.lastSeenAt,
    rejected: st.rejected,
  }));
  for (let i = 0; i < rows.length; i += 100) check(await db().from("job_states").upsert(rows.slice(i, i + 100)), "saving job_states");
}

export async function saveRun(run: RunResult, daily: boolean): Promise<void> {
  check(await db().from("runs").upsert({ ran_at: run.ranAt, preset: run.preset, daily, data: run }), "saving the run");
  await saveJobStates(run);
}

export type IdTable = "seen_jobs" | "announced_jobs";

export async function loadIds(table: IdTable): Promise<Set<string>> {
  return new Set((await selectAll<{ id: string }>(table, "id", "id")).map((r) => r.id));
}

export async function addIds(table: IdTable, ids: Iterable<string>): Promise<void> {
  const rows = [...new Set(ids)].map((id) => ({ id }));
  for (let i = 0; i < rows.length; i += 500) {
    check(await db().from(table).upsert(rows.slice(i, i + 500), { onConflict: "id", ignoreDuplicates: true }), `saving ${table}`);
  }
}

export interface StageRow {
  id: string;
  title: string;
  stage: string;
  updated_at: string;
}

export async function loadStages(): Promise<StageRow[]> {
  return selectAll<StageRow>("pipeline_leads", "id,title,stage,updated_at", "id");
}

export async function saveStageRow(row: StageRow): Promise<void> {
  check(await db().from("pipeline_leads").upsert(row), "saving the stage");
}
