import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { buildLeads, type Lead } from "@/lib/pipeline.ts";
import { latestRanAt, loadJobStates, loadPipeline } from "@/lib/pipeline-store.ts";
import type { Job } from "@/scraper/types.ts";
import { LeadBoard, type LeadRow } from "./lead-board.tsx";
import { SyncButton } from "./sync-button.tsx";

function formatBudget(b: Job["budget"]): string | null {
  if (!b) return null;
  const range = [b.feeMin, b.feeMax]
    .filter((n) => n != null)
    .map((n) => (n! >= 1000 ? `$${+(n! / 1000).toFixed(1)}k` : `$${n}`))
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
    brief: lead.applicationBrief ?? null,
  };
}

async function Dashboard() {
  await connection();
  const [states, pipeline, lastRun] = await Promise.all([loadJobStates(), loadPipeline(), latestRanAt()]);
  if (!lastRun) {
    return <p className="text-muted-foreground">No scrape data yet.</p>;
  }
  const leads = buildLeads(states, pipeline, lastRun).map(toRow);
  return (
    <>
      <p className="mb-6 text-muted-foreground">
        Jobs the AI layer qualified, across every scrape · last scrape{" "}
        {new Date(lastRun).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
      </p>
      <LeadBoard leads={leads} />
    </>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-10 pb-20 sm:px-8">
      <header className="mb-1 flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight text-balance">Leads</h1>
        <span className="flex items-baseline gap-5">
          {!process.env.VERCEL && <SyncButton />}
          <Link href="/latest" className="rounded-sm text-muted-foreground hover:text-brand">
            Latest scrape →
          </Link>
        </span>
      </header>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}
