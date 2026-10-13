import { icpCriteria } from "./icp/criteria.ts";
import { LLM_FAILED } from "./icp/llm.ts";
import type { ClassifiedJob, IcpVerdict, Job, Lane } from "./types.ts";

/** What to do with a job that fits (see Lane); null for rejected jobs. */
export function laneOf(icp: IcpVerdict): Lane | null {
  if (icp.decision === "rejected") return null;
  if (icp.project?.fullTime || icp.signals.includes("flag:full-time")) return "outreach";
  const value = icp.project?.estimatedValueUsd;
  return value != null && value < icpCriteria.minProjectUsd ? "entry" : "sprint";
}

/**
 * Worth acting on now: qualified sprints and entry projects, plus full-time roles at companies that fit even
 * as a "maybe" (the role shows they're spending on design, and reaching out costs little).
 */
export function isActionable(job: Pick<ClassifiedJob, "icp" | "lane">): boolean {
  if (job.lane === "outreach") return job.icp.decision !== "rejected";
  return job.lane != null && job.icp.decision === "qualified";
}

/**
 * A full-time role at a company worth reaching out to, checked by the LLM. These get the company lookup and
 * a lead sheet row; unlike Slack, the sheet gets every current one (it skips those it already has), so a
 * sheet connected late, or a failed send, catches up on the next run.
 */
export function isOutreachLead(job: Pick<ClassifiedJob, "icp" | "lane" | "organization">): boolean {
  return job.lane === "outreach" && isActionable(job) && !!job.organization?.name && !job.icp.signals.includes(LLM_FAILED);
}

/**
 * Attaches the verdict, lane and announce flag. A job is announced once, the first run it's actionable: a
 * new job, or an older one a rubric change now qualifies. Never before the LLM has actually read it.
 */
export function toClassified(job: Job, icp: IcpVerdict, seen: Set<string>, announced: Set<string>): ClassifiedJob {
  const lane = laneOf(icp);
  const announce = isActionable({ icp, lane }) && !announced.has(job.id) && !icp.signals.includes(LLM_FAILED);
  return { ...job, isNew: !seen.has(job.id), icp, lane, announce };
}
