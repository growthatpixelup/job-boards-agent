import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppliedJob } from "../lib/applied.ts";
import { DATA_DIR } from "./feed.ts";

// The scrape's hand-off of applied jobs: fetch.ts saves them, run.ts takes them (see lib/applied.ts).
export { appliedFromPages, toMarkApplied, type AppliedJob } from "../lib/applied.ts";

export const APPLIED_FILE = path.join(DATA_DIR, "applied.json");

export async function saveApplied(applied: AppliedJob[]): Promise<void> {
  await writeFile(APPLIED_FILE, JSON.stringify(applied));
}

/** Reads and deletes the file fetch.ts left; null when this run didn't fetch the APPLIED feed. */
export async function takeApplied(): Promise<AppliedJob[] | null> {
  try {
    const applied = JSON.parse(await readFile(APPLIED_FILE, "utf8")) as AppliedJob[];
    await rm(APPLIED_FILE, { force: true });
    return applied;
  } catch {
    return null;
  }
}
