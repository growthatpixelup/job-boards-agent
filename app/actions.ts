"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { describeSync, syncFromContra } from "@/lib/contra-sync.ts";
import { isAuthorized, PASSWORD } from "@/lib/auth.ts";
import { dispatchConfigured, findSync, isRequestId, startSync, type SyncRun } from "@/lib/github-sync.ts";
import { isStage } from "@/lib/pipeline.ts";
import { loadLatest, saveStage } from "@/lib/pipeline-store.ts";

export async function moveLead(id: string, title: string, stage: string): Promise<void> {
  if (!isAuthorized((await headers()).get("authorization"))) throw new Error("Unauthorized");
  // A hosted copy writes to the database with the service role key; it must not take writes from anyone who finds the URL.
  if (process.env.VERCEL && !PASSWORD) throw new Error("Set DASHBOARD_PASSWORD before saving stages");
  if (!isStage(stage) || typeof id !== "string" || !id || typeof title !== "string") throw new Error("Bad stage change");
  await saveStage(id, title.slice(0, 200), stage);
  refresh();
}

/**
 * "Sync from Contra". With GITHUB_DISPATCH_TOKEN set (the hosted dashboard) it starts a scrape in GitHub Actions with
 * the scraper's Contra login and returns its request id for syncStatus; without it, a local copy syncs right here
 * with its own login in .contra-auth.json (lib/contra-sync.ts).
 */
export async function syncContra(): Promise<{ started: string } | { done: string }> {
  if (!isAuthorized((await headers()).get("authorization"))) throw new Error("Unauthorized");
  // Starting a run spends the scraper's Contra login and Claude calls: not for anyone who finds the URL.
  if (process.env.VERCEL && !PASSWORD) throw new Error("Set DASHBOARD_PASSWORD before syncing");
  if (dispatchConfigured()) return { started: await startSync() };
  // The login token lives in a local file; a hosted copy has none, and must not spend a shared one.
  if (process.env.VERCEL) throw new Error("Sync needs GITHUB_DISPATCH_TOKEN in the Vercel project (README, \"Sync from Contra\")");
  const result = await syncFromContra();
  refresh();
  return { done: describeSync(result) };
}

/** Where a sync started by syncContra has got to; once it's done, the page reloads its data and gets a summary. */
export async function syncStatus(request: string): Promise<SyncRun & { summary?: string }> {
  if (!isAuthorized((await headers()).get("authorization"))) throw new Error("Unauthorized");
  if (!isRequestId(request)) throw new Error("Bad sync id");
  const run = await findSync(request);
  if (run.status !== "done") return run;
  refresh();
  const latest = await loadLatest();
  const parts = latest
    ? [
        `${(latest.board?.length ?? latest.totalScraped).toLocaleString("en-US")} jobs on Contra`,
        `${latest.newSinceLastRun} new lead${latest.newSinceLastRun === 1 ? "" : "s"}`,
        ...(latest.applied ? [`${latest.applied.length} applied on Contra`] : []),
      ]
    : [];
  return { ...run, summary: ["Synced", ...parts].join(" · ") };
}
