import type { ClassifiedJob, IcpVerdict, Lane, RunResult } from "../scraper/types.ts";

// The lead dashboard: every job the AI layer said is worth acting on, across all runs, plus the stage the
// team has moved it to. Stages live in Supabase's pipeline_leads table (see lib/pipeline-store.ts).

export const STAGES = [
  { id: "new", label: "New" },
  { id: "priority", label: "Priority" },
  { id: "applied", label: "Applied" },
  { id: "talking", label: "Talking" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
  { id: "passed", label: "Passed" },
] as const;

export type Stage = (typeof STAGES)[number]["id"];

export function isStage(s: unknown): s is Stage {
  return STAGES.some((st) => st.id === s);
}

/** The pipeline_leads table, keyed by Contra job id; the title is kept so a row reads on its own. */
export interface Pipeline {
  leads: Record<string, { title: string; stage: Stage; updatedAt: string }>;
}

export type Lead = ClassifiedJob & {
  lane: Lane;
  stage: Stage;
  stageUpdatedAt: string | null;
  /** The first run that saw the job. */
  firstSeenAt: string;
  /** The last run that saw the job; older than the latest run means it has left the board. */
  lastSeenAt: string;
  /** Still on Contra's board as of the latest run. */
  onBoard: boolean;
};

// scraper/icp/llm.ts LLM_FAILED. Not imported: llm.ts reads the brief from disk when loaded, which the Next bundle can't do.
const LLM_FAILED = "llm-failed";

/** Only the AI layer's verdicts count; runs from before it (the regex classifier) are skipped. */
function isLlmVerdict(icp: IcpVerdict): boolean {
  return icp.classifier.startsWith("anthropic") || icp.classifier.startsWith("openai");
}

/** Same rule as scraper/lanes.ts isActionable (what Slack posts): qualified projects, and full-time roles that fit even as a maybe. */
function isLead(job: ClassifiedJob, lane: string | null): lane is Lane {
  if (!isLlmVerdict(job.icp) || job.icp.signals.includes(LLM_FAILED)) return false;
  if (lane === "outreach") return job.icp.decision !== "rejected";
  // "entry" was a lane for a day (Oct 2026) and was dropped; those jobs no longer qualify.
  return lane === "project" && job.icp.decision === "qualified";
}

/** What the job_states table keeps per job: its newest verdict and when runs first and last saw it. */
export interface JobState {
  id: string;
  url: string;
  /** The newest verdict the job got while it was still kept (not rejected). */
  job: ClassifiedJob;
  firstSeenAt: string;
  /** The last run that had the job, or that rejected it. */
  lastSeenAt: string;
  /** The newest run rejected it (rejected jobs are only kept as title/url/reasons). */
  rejected: boolean;
}

/**
 * Folds one run into the job states, as the scraper saves it. `states` must hold at least the states of the run's
 * jobs and of the jobs it rejected; it is updated in place. Returns the states that changed. Runs go in oldest first.
 */
export function applyRun(states: Map<string, JobState>, run: RunResult): JobState[] {
  const changed = new Map<string, JobState>();
  for (const job of run.jobs) {
    const next: JobState = {
      id: job.id,
      url: job.url,
      job,
      firstSeenAt: states.get(job.id)?.firstSeenAt ?? run.ranAt,
      lastSeenAt: run.ranAt,
      rejected: false,
    };
    states.set(job.id, next);
    changed.set(job.id, next);
  }
  const idByUrl = new Map([...states.values()].map((st) => [st.url, st.id]));
  for (const r of run.rejected ?? []) {
    const id = idByUrl.get(r.url);
    const prev = id ? states.get(id) : undefined;
    if (!id || !prev) continue;
    const next = { ...prev, lastSeenAt: run.ranAt, rejected: true };
    states.set(id, next);
    changed.set(id, next);
  }
  return [...changed.values()];
}

/**
 * Every lead, each with its newest verdict. A job's newest verdict wins, so one a later run rejected (a stricter
 * brief) drops out, unless the team has already given it a stage. `latestRanAt` is the newest run.
 */
export function buildLeads(states: Iterable<JobState>, pipeline: Pipeline, latestRanAt: string): Lead[] {
  const leads: Lead[] = [];
  for (const st of states) {
    const staged = pipeline.leads[st.id];
    // A rejected job keeps its older verdict only while it has a stage.
    const job = st.rejected && !staged ? undefined : st.job;
    if (!job) continue;
    // Runs from before lanes existed only flagged full-time roles.
    const lane = job.lane ?? (job.icp.project?.fullTime ? "outreach" : job.icp.decision === "rejected" ? null : "project");
    if (!isLead(job, lane) && !(staged && (lane === "project" || lane === "outreach"))) continue;
    leads.push({
      ...job,
      lane: lane as Lane,
      stage: staged?.stage ?? "new",
      stageUpdatedAt: staged?.updatedAt ?? null,
      firstSeenAt: st.firstSeenAt,
      lastSeenAt: st.lastSeenAt,
      onBoard: st.lastSeenAt === latestRanAt,
    });
  }
  return leads.sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt) || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/** Returns a new pipeline with the job moved to the stage. */
export function setStage(pipeline: Pipeline, id: string, title: string, stage: Stage, now = new Date()): Pipeline {
  return { leads: { ...pipeline.leads, [id]: { title, stage, updatedAt: now.toISOString() } } };
}
