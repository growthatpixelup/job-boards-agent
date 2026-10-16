import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatBudget, formatDuration, ist } from "@/lib/format.ts";
import { loadLatest, loadPipeline } from "@/lib/pipeline-store.ts";
import type { BoardJob } from "@/scraper/types.ts";
import { SyncButton } from "../sync-button.tsx";
import { JobBoard, type BoardRow } from "./job-board.tsx";

// Every job on Contra's board as of the latest scrape, laid out like Contra's own job feed, with the AI layer's
// verdict on each. Descriptions are never stored (README, "Rules"), so the full post is one click away on Contra.

function toRow(j: BoardJob, appliedIds: Set<string>, stages: Record<string, { stage: string }>): BoardRow {
  const p = j.icp?.project;
  const offset = j.timezone.primaryUtcOffset;
  return {
    id: j.id,
    title: j.title,
    url: j.url,
    company: j.organization?.name ?? (j.hiringAsIndividual ? null : "Company not named"),
    verified: !!j.organization?.isVerified,
    postedAt: j.approvedAt ?? j.createdAt,
    budget: formatBudget(j.budget),
    budgetType: j.budget?.type ?? "UNKNOWN",
    budgetTop: j.budget?.feeMax ?? j.budget?.feeMin ?? null,
    duration: formatDuration(j.duration),
    timezone: offset == null ? null : `UTC${offset >= 0 ? "+" : "−"}${Math.abs(offset)}${j.timezone.offsetTolerance ? ` ±${j.timezone.offsetTolerance}h` : ""}`,
    country: j.country,
    skills: [...new Set([...j.roles, ...j.tools])],
    decision: j.icp?.decision ?? null,
    fullTime: j.lane === "outreach" || !!p?.fullTime,
    valueUsd: p?.estimatedValueUsd ?? null,
    scope: p?.scope || null,
    reasons: (j.icp?.reasons ?? []).filter((r) => !r.startsWith("⚠")).slice(0, 4),
    concerns: p?.concerns ?? [],
    applied: j.visitor.applied || appliedIds.has(j.id),
    bookmarked: j.visitor.bookmarked,
    matched: j.visitor.matched,
    stage: stages[j.id]?.stage ?? null,
  };
}

/** The latest scrape as board rows, and the time they were read (for "posted 3h ago"). */
async function loadBoard() {
  await connection();
  const [run, pipeline] = await Promise.all([loadLatest(), loadPipeline()]);
  if (!run) return null;
  const appliedIds = new Set((run.applied ?? []).map((j) => j.id));
  // Runs saved before the whole board was kept only have the jobs that passed, plus the rejected titles.
  const board: BoardJob[] =
    run.board ??
    [
      ...run.jobs,
      ...run.rejected.map((r) => ({
        id: r.url, title: r.title, slug: "", url: r.url, createdAt: null, approvedAt: null, category: null, organization: null,
        country: null, hiringAsIndividual: false, budget: null, duration: null, roles: [], tools: [],
        timezone: { primaryUtcOffset: null, offsetTolerance: null },
        visitor: { applied: false, bookmarked: false, dismissed: false, viewed: false, matched: false },
        icp: { decision: "rejected" as const, tier: null, score: 0, reasons: r.reasons, signals: [], classifier: run.classifier },
      })),
    ];
  return { run, rows: board.map((j) => toRow(j, appliedIds, pipeline.leads)), readAt: Date.now() };
}

async function Board() {
  const data = await loadBoard();
  if (!data) return <p className="text-muted-foreground">No scrape data yet.</p>;
  const { run, rows, readAt } = data;
  return (
    <>
      <p className="mb-6 text-muted-foreground">
        {rows.length.toLocaleString("en-US")} open jobs on Contra · last scrape {ist(run.ranAt)}
        {!run.board && " · budgets and skills for every job appear after the next scrape"}
      </p>
      <JobBoard jobs={rows} now={readAt} />
    </>
  );
}

export default function ContraBoard() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-10 pb-20 sm:px-8">
      <header className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight text-balance">All jobs</h1>
        <span className="flex flex-wrap items-baseline justify-end gap-x-5 gap-y-1">
          <SyncButton />
          <Link href="/" className="rounded-sm text-muted-foreground hover:text-brand">
            ← Leads
          </Link>
        </span>
      </header>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Board />
      </Suspense>
    </main>
  );
}
