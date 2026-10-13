import { readFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import { Suspense } from "react";
import type { ClassifiedJob, IcpDecision, Job, Lane, RunResult } from "@/scraper/types.ts";

async function loadLatest(): Promise<RunResult | null> {
  try {
    const file = path.join(process.cwd(), "data", "latest.json");
    return JSON.parse(await readFile(file, "utf8")) as RunResult;
  } catch {
    return null;
  }
}

function formatBudget(b: Job["budget"]): string {
  if (!b) return "—";
  const range = [b.feeMin, b.feeMax].filter((n) => n != null).join(" – ");
  const unit = { FIXED: "fixed", HOURLY: "/hr", WEEKLY: "/wk", MONTHLY: "/mo", UNKNOWN: "" }[b.type];
  return range ? `${range} ${unit}` : b.type.toLowerCase();
}

const DECISION_STYLE: Record<IcpDecision, string> = {
  qualified: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  maybe: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  rejected: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const LANE_BADGE: Partial<Record<Lane, { label: string; title: string; style: string }>> = {
  entry: {
    label: "entry",
    title: "Small now, from a client that could grow into a sprint",
    style: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100",
  },
  outreach: {
    label: "full-time",
    title: "Reach out on a different platform instead of applying on Contra",
    style: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100",
  },
};

function LaneBadge({ job }: { job: ClassifiedJob }) {
  // Runs from before lanes existed only flagged full-time roles.
  const lane = job.lane ?? (job.icp?.project?.fullTime ? "outreach" : null);
  const badge = lane && LANE_BADGE[lane];
  if (!badge) return null;
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${badge.style}`} title={badge.title}>
      {badge.label}
    </span>
  );
}

async function JobList() {
  await connection();
  const run = await loadLatest();

  if (!run) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        No data yet. Run <code className="font-mono">/contra-scrape</code> in Claude Code to fetch jobs via the Contra MCP.
      </p>
    );
  }

  return (
    <>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Last run {new Date(run.ranAt).toLocaleString()} · {run.totalScraped} scraped ·{" "}
        {run.classifier === "none"
          ? "ICP filter off"
          : `${run.counts?.qualified ?? 0} qualified · ${run.counts?.maybe ?? 0} maybe · ${run.counts?.rejected ?? 0} rejected by ICP`}{" "}
        · {run.newSinceLastRun} new
        {run.accessLimited && ` · feed limited to your account's preview (${run.boardTotal ?? "?"} on the board)`}
      </p>
      {run.jobs.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">No jobs in this run.</p>
      )}
      <ul className="flex flex-col gap-3">
        {run.jobs.map((job) => (
          <li key={job.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-start justify-between gap-4">
              <a href={job.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                {job.title}
              </a>
              <span className="flex shrink-0 gap-1">
                {job.icp && job.icp.classifier !== "none" && (
                  <span className={`rounded px-2 py-0.5 text-xs ${DECISION_STYLE[job.icp.decision]}`}>
                    {job.icp.decision}
                    {job.icp.tier && ` · ${job.icp.tier}`}
                  </span>
                )}
                <LaneBadge job={job} />
                {job.isNew && (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100">
                    new
                  </span>
                )}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {[job.organization?.name, formatBudget(job.budget), job.createdAt && new Date(job.createdAt).toLocaleDateString()]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {job.icp?.project && (
              <p className="mt-2 text-sm">
                <span className="font-medium">
                  {job.icp.project.estimatedValueUsd != null
                    ? `~$${job.icp.project.estimatedValueUsd.toLocaleString("en-US")}`
                    : "Size unclear"}
                  {job.icp.project.sprintTypes.length > 0 && ` · ${job.icp.project.sprintTypes.join(" + ")}`}
                </span>
                {job.icp.project.scope && ` — ${job.icp.project.scope}`}
                {job.icp.project.basis && (
                  <span className="block text-xs text-zinc-500">{job.icp.project.basis}</span>
                )}
                {job.icp.project.growthPath && job.icp.project.growthPotential !== "none" && (
                  <span className="block text-xs text-zinc-500">
                    Could grow ({job.icp.project.growthPotential}): {job.icp.project.growthPath}
                  </span>
                )}
              </p>
            )}
            {job.companyLinks && (
              <p className="mt-2 flex gap-3 text-xs">
                {([["Website", job.companyLinks.website], ["LinkedIn", job.companyLinks.linkedin], ["X", job.companyLinks.x]] as const)
                  .filter(([, href]) => href)
                  .map(([label, href]) => (
                    <a key={label} href={href!} target="_blank" rel="noreferrer" className="underline hover:no-underline">
                      {label}
                    </a>
                  ))}
              </p>
            )}
            {(job.roles.length > 0 || job.tools.length > 0) && (
              <p className="mt-2 text-xs text-zinc-500">{[...job.roles, ...job.tools].join(", ")}</p>
            )}
            {job.icp && job.icp.reasons.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-zinc-600 dark:text-zinc-400">
                {job.icp.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-semibold">Contra jobs</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <JobList />
      </Suspense>
    </main>
  );
}
