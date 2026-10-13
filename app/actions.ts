"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { isAuthorized, PASSWORD } from "@/lib/auth.ts";
import { isStage } from "@/lib/pipeline.ts";
import { saveStage, savesToGitHub } from "@/lib/pipeline-store.ts";

export async function moveLead(id: string, title: string, stage: string): Promise<void> {
  if (!isAuthorized((await headers()).get("authorization"))) throw new Error("Unauthorized");
  // A hosted copy that commits to GitHub must not take writes from anyone who finds the URL.
  if (savesToGitHub && !PASSWORD) throw new Error("Set DASHBOARD_PASSWORD before saving stages to GitHub");
  if (!isStage(stage) || typeof id !== "string" || !id || typeof title !== "string") throw new Error("Bad stage change");
  await saveStage(id, title.slice(0, 200), stage);
  refresh();
}
