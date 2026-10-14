"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { describeSync, syncFromContra } from "@/lib/contra-sync.ts";
import { isAuthorized, PASSWORD } from "@/lib/auth.ts";
import { isStage } from "@/lib/pipeline.ts";
import { saveStage } from "@/lib/pipeline-store.ts";

export async function moveLead(id: string, title: string, stage: string): Promise<void> {
  if (!isAuthorized((await headers()).get("authorization"))) throw new Error("Unauthorized");
  // A hosted copy writes to the database with the service role key; it must not take writes from anyone who finds the URL.
  if (process.env.VERCEL && !PASSWORD) throw new Error("Set DASHBOARD_PASSWORD before saving stages");
  if (!isStage(stage) || typeof id !== "string" || !id || typeof title !== "string") throw new Error("Bad stage change");
  await saveStage(id, title.slice(0, 200), stage);
  refresh();
}

/** Local only: pulls applied jobs and unread replies from Contra (see lib/contra-sync.ts). */
export async function syncContra(): Promise<string> {
  if (!isAuthorized((await headers()).get("authorization"))) throw new Error("Unauthorized");
  // The login token lives in a local file; a hosted copy has none, and must not spend a shared one.
  if (process.env.VERCEL) throw new Error("Contra sync only runs locally");
  const result = await syncFromContra();
  refresh();
  return describeSync(result);
}
