import { addIds, loadLatestRun } from "../lib/db.ts";
import { slackBlocks, slackMessage } from "./announce.ts";

// Posts the latest run's (from Supabase) announced jobs (fitting, and never posted before) to Slack, grouped by lane.
// Two webhook kinds: an Incoming Webhook (hooks.slack.com/services/...) gets Block Kit, one card per job; a Workflow
// Builder trigger (hooks.slack.com/triggers/...) gets two Text variables, `summary` and `jobs`.
// Env: SLACK_WEBHOOK_URL (skips quietly when unset), SLACK_DRY_RUN=1 prints the payload instead
//      (SLACK_FORMAT=blocks prints the Block Kit one),
//      LEADS_SHEET_URL (optional) links the lead sheet under the full-time roles,
//      DASHBOARD_URL (optional) links the lead dashboard at the end.

async function main() {
  const run = await loadLatestRun();
  if (!run) return void console.log("[notify] no run saved yet; nothing to post");
  const sheetUrl = process.env.LEADS_SHEET_URL || undefined;
  const dashboardUrl = process.env.DASHBOARD_URL || undefined;
  const url = process.env.SLACK_WEBHOOK_URL;
  // A Workflow Builder webhook (/triggers/) only takes the two text variables; an Incoming Webhook (/services/)
  // takes Block Kit, which lays each job out as its own card with an Apply button.
  const useBlocks = url ? !url.includes("/triggers/") : process.env.SLACK_FORMAT === "blocks";
  const payload = useBlocks ? slackBlocks(run, sheetUrl, dashboardUrl) : slackMessage(run, sheetUrl, dashboardUrl);
  const summary = slackMessage(run, sheetUrl).summary;

  if (process.env.SLACK_DRY_RUN) return void console.log(JSON.stringify(payload, null, 2));
  if (!url) return void console.log("[notify] SLACK_WEBHOOK_URL not set; skipping Slack");

  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  console.log(`[notify] posted to Slack: ${summary}`);
  // Only now: a failed post leaves them unannounced, so the next run posts them.
  await addIds("announced_jobs", run.jobs.filter((j) => j.announce).map((j) => j.id));
}

main().catch((err) => {
  console.error(`[notify] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
