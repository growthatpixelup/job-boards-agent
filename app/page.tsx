import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatBudget, ist } from "@/lib/format.ts";
import { buildLeads, type Lead } from "@/lib/pipeline.ts";
import { loadJobStates, loadLatest, loadPipeline } from "@/lib/pipeline-store.ts";
import { LeadBoard, type LeadRow } from "./lead-board.tsx";
import { SyncButton } from "./sync-button.tsx";

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
    appliedOnContra: lead.appliedOnContra,
    judged: lead.judged,
  };
}

async function Dashboard() {
  await connection();
  const [states, pipeline, run] = await Promise.all([loadJobStates(), loadPipeline(), loadLatest()]);
  if (!run) {
    return <p className="text-muted-foreground">No scrape data yet.</p>;
  }
  // Runs from before the board and the APPLIED feed were saved have neither; the leads then work as before.
  const contra = { applied: run.applied ?? [], boardIds: run.board ? new Set(run.board.map((j) => j.id)) : null };
  const leads = buildLeads(states, pipeline, new Date(run.ranAt).toISOString(), contra).map(toRow);
  return (
    <>
      <p className="mb-6 text-muted-foreground">
        Jobs the AI layer qualified, plus every job applied to on Contra · last scrape {ist(run.ranAt)}
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
        <span className="flex flex-wrap items-baseline justify-end gap-x-5 gap-y-1">
          <SyncButton />
          <Link href="/contra" className="rounded-sm text-muted-foreground hover:text-brand">
            All jobs →
          </Link>
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
