import type { ClassifiedJob, IcpVerdict, Lane, RunResult } from "../scraper/types.ts";

// The lead dashboard: every job the AI layer said is worth acting on, across all runs, plus the stage the
// team has moved it to. Stages live in data/pipeline.json (see lib/pipeline-store.ts).

export const STAGES = [
  { id: "new", label: "New" },
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

/** data/pipeline.json. Keyed by Contra job id; the title is kept so the file (and its git history) reads on its own. */
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

/**
 * Every lead across the runs, each with its newest verdict. A job's newest verdict wins, so one a later run
 * rejected (a stricter brief) drops out, unless the team has already given it a stage.
 */
export function buildLeads(runs: RunResult[], pipeline: Pipeline): Lead[] {
  const sorted = [...runs].sort((a, b) => a.ranAt.localeCompare(b.ranAt));
  const latestRanAt = sorted.at(-1)?.ranAt ?? "";
  const firstSeen = new Map<string, string>();
  const newest = new Map<string, { job: ClassifiedJob | null; ranAt: string }>();
  const idByUrl = new Map<string, string>();

  for (const run of sorted) {
    for (const job of run.jobs) {
      if (!firstSeen.has(job.id)) firstSeen.set(job.id, run.ranAt);
      newest.set(job.id, { job, ranAt: run.ranAt });
      idByUrl.set(job.url, job.id);
    }
    // Rejected jobs are only kept as title/url/reasons.
    for (const r of run.rejected ?? []) {
      const id = idByUrl.get(r.url);
      if (id) newest.set(id, { job: null, ranAt: run.ranAt });
    }
  }

  // Older verdicts, for jobs whose newest verdict is a rejection but that already have a stage.
  const lastFit = new Map<string, ClassifiedJob>();
  for (const run of sorted) for (const job of run.jobs) lastFit.set(job.id, job);

  const leads: Lead[] = [];
  for (const [id, { job: newestJob, ranAt }] of newest) {
    const staged = pipeline.leads[id];
    const job = newestJob ?? (staged ? lastFit.get(id) : undefined);
    if (!job) continue;
    // Runs from before lanes existed only flagged full-time roles.
    const lane = job.lane ?? (job.icp.project?.fullTime ? "outreach" : job.icp.decision === "rejected" ? null : "project");
    if (!isLead(job, lane) && !(staged && (lane === "project" || lane === "outreach"))) continue;
    leads.push({
      ...job,
      lane: lane as Lane,
      stage: staged?.stage ?? "new",
      stageUpdatedAt: staged?.updatedAt ?? null,
      firstSeenAt: firstSeen.get(id)!,
      lastSeenAt: ranAt,
      onBoard: ranAt === latestRanAt,
    });
  }
  return leads.sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt) || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/** Returns a new pipeline with the job moved to the stage. */
export function setStage(pipeline: Pipeline, id: string, title: string, stage: Stage, now = new Date()): Pipeline {
  return { leads: { ...pipeline.leads, [id]: { title, stage, updatedAt: now.toISOString() } } };
}

export function parsePipeline(text: string | null): Pipeline {
  if (!text) return { leads: {} };
  const parsed = JSON.parse(text) as Partial<Pipeline>;
  return { leads: parsed.leads ?? {} };
}

/** Stable, diff-friendly: sorted keys, one lead per line block. */
export function serializePipeline(pipeline: Pipeline): string {
  const leads = Object.fromEntries(Object.entries(pipeline.leads).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ leads }, null, 2) + "\n";
}
