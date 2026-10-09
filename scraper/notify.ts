import { readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./feed.ts";
import type { ClassifiedJob, RunResult } from "./types.ts";

// Posts the latest run's new matches (qualified/maybe, never seen before) to Slack via a
// Workflow Builder webhook trigger with two Text variables: `summary` and `jobs`.
// Env: SLACK_WEBHOOK_URL (skips quietly when unset), SLACK_DRY_RUN=1 prints the payload instead.

const MAX_JOBS = 15; // keep the message readable; the rest are summarized

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function budget(b: ClassifiedJob["budget"]): string {
  if (!b || (b.feeMin == null && b.feeMax == null)) return "budget n/a";
  const range = b.feeMin != null && b.feeMax != null && b.feeMin !== b.feeMax
    ? `${money(b.feeMin)}–${money(b.feeMax)}`
    : money((b.feeMax ?? b.feeMin) as number);
  return range + { FIXED: " fixed", HOURLY: "/hr", WEEKLY: "/wk", MONTHLY: "/mo", UNKNOWN: "" }[b.type];
}

function line(j: ClassifiedJob): string {
  const client = j.organization?.name ?? j.owner;
  return `• [${j.icp.decision}] ${j.title} · ${[budget(j.budget), client].filter(Boolean).join(" · ")}\n  ${j.url}`;
}

async function main() {
  const run = JSON.parse(await readFile(path.join(DATA_DIR, "latest.json"), "utf8")) as RunResult;
  const fresh = run.jobs.filter((j) => j.isNew && j.icp.decision !== "rejected");
  const when = new Date(run.ranAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  });

  const summary = fresh.length
    ? `${fresh.length} new match${fresh.length === 1 ? "" : "es"} · ${when} IST run · ${run.totalScraped} jobs scanned`
    : `No new matches · ${when} IST run · ${run.totalScraped} jobs scanned`;
  const jobs = fresh.length
    ? fresh.slice(0, MAX_JOBS).map(line).join("\n") +
      (fresh.length > MAX_JOBS ? `\n…and ${fresh.length - MAX_JOBS} more in data/latest.json` : "")
    : "—";
  const payload = { summary, jobs };

  if (process.env.SLACK_DRY_RUN) return void console.log(JSON.stringify(payload, null, 2));
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return void console.log("[notify] SLACK_WEBHOOK_URL not set; skipping Slack");

  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  console.log(`[notify] posted to Slack: ${summary}`);
}

main().catch((err) => {
  console.error(`[notify] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
