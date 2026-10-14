import { latestRanAt, loadJobStates, loadLatestRun, loadStages, saveStageRow } from "./db.ts";
import { isStage, setStage, type Pipeline, type Stage } from "./pipeline.ts";

// What the dashboard reads and saves, all in Supabase (lib/db.ts): each job's newest verdict, the latest scrape
// and the stage of each lead.

/** The latest scrape. */
export const loadLatest = loadLatestRun;

export { latestRanAt, loadJobStates };

export async function loadPipeline(): Promise<Pipeline> {
  const leads: Pipeline["leads"] = {};
  for (const r of await loadStages()) {
    if (isStage(r.stage)) leads[r.id] = { title: r.title, stage: r.stage, updatedAt: new Date(r.updated_at).toISOString() };
  }
  return { leads };
}

export async function saveStage(id: string, title: string, stage: Stage): Promise<void> {
  const { title: t, stage: s, updatedAt } = setStage({ leads: {} }, id, title, stage).leads[id];
  await saveStageRow({ id, title: t, stage: s, updated_at: updatedAt });
}
