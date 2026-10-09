import { readFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import { Suspense } from "react";
import type { IcpDecision, Job, RunResult } from "@/scraper/types.ts";

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
