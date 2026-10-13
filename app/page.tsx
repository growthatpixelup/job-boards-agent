import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { buildLeads, type Lead } from "@/lib/pipeline.ts";
import { loadPipeline, loadRuns, savesToGitHub } from "@/lib/pipeline-store.ts";
import type { Job } from "@/scraper/types.ts";
import { LeadBoard, type LeadRow } from "./lead-board.tsx";

function formatBudget(b: Job["budget"]): string | null {
  if (!b) return null;
  const range = [b.feeMin, b.feeMax]
    .filter((n) => n != null)
    .map((n) => `$${n!.toLocaleString("en-US")}`)
    .join("–");
  const unit = { FIXED: " fixed", HOURLY: "/hr", WEEKLY: "/wk", MONTHLY: "/mo", UNKNOWN: "" }[b.type];
  return range ? `${range}${unit}` : null;
}

/** Only what the board shows, so the page doesn't ship whole run records to the browser. */
function toRow(lead: Lead): LeadRow {
  const p = lead.icp.project;
  return {
    id: lead.id,
    title: lead.title,
    url: lead.url,
    company: lead.organization?.name ?? (lead.hiringAsIndividual ? "Private client" : null),
    budget: formatBudget(lead.budget),
    valueUsd: p?.estimatedValueUsd ?? null,
    rateUsd: p?.hourlyRateUsd ?? null,
    lane: lead.lane,
    decision: lead.icp.decision,
    scope: p?.scope ?? null,
    basis: p?.basis ?? null,
    growth: p && p.growthPotential !== "none" && p.growthPath ? `${p.growthPotential}: ${p.growthPath}` : null,
    concerns: p?.concerns ?? [],
    reasons: lead.icp.reasons.filter((r) => !r.startsWith("⚠")),
    companyLinks: lead.companyLinks ?? null,
    postedAt: lead.createdAt,
    firstSeenAt: lead.firstSeenAt,
    onBoard: lead.onBoard,
    stage: lead.stage,
  };
}

async function Dashboard() {
  await connection();
  const [runs, pipeline] = await Promise.all([loadRuns(), loadPipeline()]);
  const lastRun = runs.map((r) => r.ranAt).sort().at(-1);
  if (!lastRun) {
    return <p className="text-zinc-600 dark:text-zinc-400">No scrape data yet.</p>;
  }
  const leads = buildLeads(runs, pipeline).map(toRow);
  return (
    <>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Jobs the AI layer qualified, from every scrape · last scrape {new Date(lastRun).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
        {" · "}stages save to <code className="font-mono text-xs">data/pipeline.json</code>
        {savesToGitHub ? " on GitHub" : " (commit it to share)"}
      </p>
      <LeadBoard leads={leads} />
    </>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Leads</h1>
        <Link href="/latest" className="text-sm text-zinc-500 underline hover:no-underline">
          Latest scrape
        </Link>
      </div>
      <Suspense fallback={<p>Loading…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}
