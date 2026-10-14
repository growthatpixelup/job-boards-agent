import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { addIds, db, saveRun, saveStageRow } from "../lib/db.ts";
import { isStage } from "../lib/pipeline.ts";
import type { RunResult } from "../scraper/types.ts";

// One-off: copies the old data/ JSON files into Supabase (supabase/migrations/ must be applied first).
// Safe to re-run: runs and stages are upserted, ids are added if missing.
// Usage: npm run db:import

const DATA = path.resolve(import.meta.dirname, "..", "data");

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function main() {
  const files = (await readdir(path.join(DATA, "runs")).catch(() => [] as string[])).filter((f) => f.endsWith(".json"));
  const runs = new Map<string, RunResult>();
  for (const f of files) {
    const run = await readJson<RunResult>(path.join(DATA, "runs", f));
    if (run?.ranAt) runs.set(run.ranAt, run);
  }
  const latest = await readJson<RunResult>(path.join(DATA, "latest.json"));
  if (latest?.ranAt) runs.set(latest.ranAt, latest);
  // Oldest first: job_states is built by folding the runs in order.
  for (const run of [...runs.values()].sort((a, b) => a.ranAt.localeCompare(b.ranAt))) await saveRun(run, false);
  console.log(`[import] ${runs.size} run(s)`);

  const seen = (await readJson<string[]>(path.join(DATA, "seen-ids.json"))) ?? [];
  await addIds("seen_jobs", seen);
  console.log(`[import] ${seen.length} seen id(s)`);
  const announced = (await readJson<string[]>(path.join(DATA, "announced-ids.json"))) ?? [];
  await addIds("announced_jobs", announced);
  console.log(`[import] ${announced.length} announced id(s)`);

  const pipeline = await readJson<{ leads?: Record<string, { title: string; stage: string; updatedAt: string }> }>(path.join(DATA, "pipeline.json"));
  let stages = 0;
  for (const [id, l] of Object.entries(pipeline?.leads ?? {})) {
    if (!isStage(l.stage)) continue;
    await saveStageRow({ id, title: l.title, stage: l.stage, updated_at: l.updatedAt });
    stages++;
  }
  console.log(`[import] ${stages} stage(s) (data/pipeline.json ${pipeline ? "found" : "not present"})`);

  for (const [table, expected] of [["runs", runs.size], ["job_states", -1], ["seen_jobs", seen.length], ["announced_jobs", announced.length]] as const) {
    const { count, error } = await db().from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`verify ${table}: ${error.message}`);
    console.log(`[import] ${table}: ${count} row(s) in Supabase ${expected >= 0 ? ` (imported ${expected})` : ""}`);
  }
}

main().catch((err) => {
  console.error(`[import] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
