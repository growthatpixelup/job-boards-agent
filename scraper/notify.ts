import { readFile } from "node:fs/promises";
import path from "node:path";
import { slackMessage } from "./announce.ts";
import { DATA_DIR } from "./feed.ts";
import type { RunResult } from "./types.ts";

// Posts the latest run's announced jobs (fitting, and never posted before) to Slack, grouped by lane, via a
// Workflow Builder webhook trigger with two Text variables: `summary` and `jobs`.
// Env: SLACK_WEBHOOK_URL (skips quietly when unset), SLACK_DRY_RUN=1 prints the payload instead,
//      LEADS_SHEET_URL (optional) links the lead sheet under the full-time roles.

async function main() {
  const run = JSON.parse(await readFile(path.join(DATA_DIR, "latest.json"), "utf8")) as RunResult;
  const payload = slackMessage(run, process.env.LEADS_SHEET_URL || undefined);

  if (process.env.SLACK_DRY_RUN) return void console.log(JSON.stringify(payload, null, 2));
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return void console.log("[notify] SLACK_WEBHOOK_URL not set; skipping Slack");

  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  console.log(`[notify] posted to Slack: ${payload.summary}`);
}

main().catch((err) => {
  console.error(`[notify] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
