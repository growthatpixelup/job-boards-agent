import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./feed.ts";

// "Applied sync": jobs the Contra account applied to (list_job_feed, preset APPLIED) move to the "Applied" stage
// in the dashboard on their own. Contra shows a freelancer nothing beyond "applied", so later stages stay manual.
// Only the job id and title are kept; poster details are never read.

export const APPLIED_FILE = path.join(DATA_DIR, "applied.json");

export interface AppliedJob {
  id: string;
  title: string;
}

/** The jobs applied to, from raw list_job_feed pages (preset APPLIED). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function appliedFromPages(pages: any[]): AppliedJob[] {
  const out = new Map<string, AppliedJob>();
  for (const page of pages) {
    for (const e of page?.entries ?? []) {
      const job = e?.job;
      if (!job?.jobId || e.visitorDidApply === false) continue; // ads, and entries the account didn't apply to
      out.set(job.jobId, { id: job.jobId, title: String(job.title ?? "").slice(0, 200) });
    }
  }
  return [...out.values()];
}

/**
 * The applied jobs whose stage should become "applied": those with no stage yet, or still "new". A stage the team
 * set by hand (talking, won, lost, passed) is never overwritten.
 */
export function toMarkApplied(applied: AppliedJob[], stages: { id: string; stage: string }[]): AppliedJob[] {
  const current = new Map(stages.map((s) => [s.id, s.stage]));
  return applied.filter((a) => {
    const stage = current.get(a.id);
    return !stage || stage === "new";
  });
}

export async function saveApplied(applied: AppliedJob[]): Promise<void> {
  await writeFile(APPLIED_FILE, JSON.stringify(applied));
}

/** Reads and deletes the file fetch.ts left; null when this run didn't fetch the APPLIED feed. */
export async function takeApplied(): Promise<AppliedJob[] | null> {
  try {
    const applied = JSON.parse(await readFile(APPLIED_FILE, "utf8")) as AppliedJob[];
    await rm(APPLIED_FILE, { force: true });
    return applied;
  } catch {
    return null;
  }
}
