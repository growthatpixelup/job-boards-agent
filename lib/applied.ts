import { normalize, withoutDescription } from "../scraper/contra.ts";
import type { BoardJob } from "../scraper/types.ts";

// "Applied sync": jobs the Contra account applied to (list_job_feed, preset APPLIED) move to the "Applied" stage
// in the dashboard on their own. Contra shows a freelancer nothing beyond "applied", so later stages stay manual.
// Each keeps its feed record (normalize: company name only, no description) so the Applied tab can show jobs the
// AI layer never put on the board; poster details are never read.

export interface AppliedJob {
  id: string;
  title: string;
  job?: BoardJob;
}

/** The jobs applied to, from raw list_job_feed pages (preset APPLIED). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function appliedFromPages(pages: any[]): AppliedJob[] {
  const out = new Map<string, AppliedJob>();
  for (const page of pages) {
    for (const e of page?.entries ?? []) {
      const job = e?.job;
      if (!job?.jobId || e.visitorDidApply === false) continue; // ads, and entries the account didn't apply to
      const record = withoutDescription(normalize(e)!);
      out.set(job.jobId, { id: job.jobId, title: String(job.title ?? "").slice(0, 200), job: { ...record, visitor: { ...record.visitor, applied: true } } });
    }
  }
  return [...out.values()];
}

/**
 * The applied jobs whose stage should become "applied": those with no stage yet, or still "new" or "priority"
 * (a priority job is one the team flagged to apply to, and now someone has). A stage the team
 * set by hand (talking, won, lost, passed) is never overwritten.
 */
export function toMarkApplied(applied: AppliedJob[], stages: { id: string; stage: string }[]): AppliedJob[] {
  const current = new Map(stages.map((s) => [s.id, s.stage]));
  return applied.filter((a) => {
    const stage = current.get(a.id);
    return !stage || stage === "new" || stage === "priority";
  });
}
