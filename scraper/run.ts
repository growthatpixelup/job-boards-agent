import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { addIds, loadIds, loadStages, saveRun, saveStageRow } from "../lib/db.ts";
import { takeApplied, toMarkApplied } from "./applied.ts";
import { addBriefs, getBriefWriter } from "./brief.ts";
import { boardOf } from "./board.ts";
import { RAW_DIR, loadFeed, minimizeDetails, pruneDetails } from "./feed.ts";
import { filterConfig, matchesFilters } from "./filters.ts";
import { LLM_FAILED, getClassifier } from "./icp/index.ts";
import { isOutreachLead, toClassified } from "./lanes.ts";
import { LEADS_DIR, getLeadFinder, type Lead } from "./leads.ts";
import { mapPool } from "./pool.ts";
import type { ClassifiedJob, IcpDecision, Job, Lane, RunResult } from "./types.ts";

// Ingests the raw MCP feed pages (data/raw/) plus cached descriptions (data/details/)
// saved by the /contra-scrape skill, classifies each job against the ICP, sorts the ones
// that fit into lanes, looks up the companies behind full-time roles, and writes
// the run to Supabase (runs table) for the app.

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

const RANK: Record<IcpDecision, number> = { qualified: 0, maybe: 1, rejected: 2 };

/**
 * Adds the company's public links to each full-time lead. Each company is looked up once: the result, with
 * the founders for the lead sheet, is cached in data/leads/ (gitignored; the workflow keeps it with
 * actions/cache). `feedIds` set: drop cached leads for jobs no longer in the feed.
 */
async function lookUpLeads(jobs: ClassifiedJob[], feedIds: Set<string> | null): Promise<void> {
  await mkdir(LEADS_DIR, { recursive: true });
  if (feedIds) {
    for (const f of await readdir(LEADS_DIR)) {
      if (f.endsWith(".json") && !feedIds.has(f.slice(0, -5))) await rm(path.join(LEADS_DIR, f), { force: true });
    }
  }
  const findLead = getLeadFinder();
  for (const j of jobs.filter(isOutreachLead)) {
    const file = path.join(LEADS_DIR, `${j.id}.json`);
    let lead = await readJson<Lead | null>(file, null);
    if (!lead && findLead) {
      try {
        lead = await findLead(j);
        await writeFile(file, JSON.stringify(lead));
        console.log(`[contra] lead: ${j.organization!.name} (${lead.found ? `${lead.confidence} confidence` : "not found"}, ${lead.people.length} people)`);
      } catch (err) {
        console.warn(`[contra] lead lookup failed for ${j.organization!.name}, retried next run: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (lead) j.companyLinks = { website: lead.website, linkedin: lead.linkedin, x: lead.x };
  }
}

async function main() {
  await minimizeDetails();
  const feed = await loadFeed();
  if (!feed.pages) {
    throw new Error(`no feed pages in ${RAW_DIR}. Run /contra-scrape in Claude Code to fetch them via the Contra MCP.`);
  }

  const classifier = getClassifier();
  const seen = await loadIds("seen_jobs");
  // Jobs already posted to Slack, so each is posted once: when it's new, or when a rubric change first qualifies it.
  const announced = await loadIds("announced_jobs");

  const candidates = feed.jobs.filter((j) => matchesFilters(j));
  const verdicts = await mapPool(candidates, classifier.concurrency, (j: Job) => classifier.classify(j));
  const classified: ClassifiedJob[] = candidates.map((j, i) => toClassified(j, verdicts[i], seen, announced));

  const counts: Record<IcpDecision, number> = { qualified: 0, maybe: 0, rejected: 0 };
  for (const j of classified) counts[j.icp.decision]++;

  // Jobs the LLM couldn't check stay unseen and unannounced so the next run retries them; if every call
  // failed (bad key, outage), stop before anything is saved or posted to Slack.
  const failed = new Set(classified.filter((j) => j.icp.signals.includes(LLM_FAILED)).map((j) => j.id));
  if (failed.size && failed.size === classified.length) {
    const reason = classified.find((j) => failed.has(j.id))!.icp.reasons.at(-1);
    throw new Error(`all ${failed.size} ${classifier.name} calls failed; nothing saved or sent. Last error: ${reason}`);
  }
  if (failed.size) console.warn(`[contra] ${failed.size} job(s) not checked by ${classifier.name}; they'll be retried next run`);

  const kept = classified.filter((j) => filterConfig.keepDecisions.includes(j.icp.decision));
  kept.sort(
    (a, b) =>
      RANK[a.icp.decision] - RANK[b.icp.decision] ||
      Number(b.isNew) - Number(a.isNew) ||
      b.icp.score - a.icp.score ||
      (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );
  const preset = process.argv[2] || "ALL";
  // Only the full feed tells us which jobs are gone; a BOOKMARKED/APPLIED run must not prune the rest.
  await lookUpLeads(kept, preset === "ALL" ? new Set(feed.jobs.map((j) => j.id)) : null);
  // Needs the descriptions, so before they're dropped from the output below.
  const briefs = await addBriefs(kept, getBriefWriter(), { feedIds: preset === "ALL" ? new Set(feed.jobs.map((j) => j.id)) : null });
  if (briefs.written || briefs.failed) console.log(`[contra] briefs: ${briefs.written} written, ${briefs.cached} cached, ${briefs.failed} failed`);

  // Jobs applied to on Contra (fetch.ts read the APPLIED feed); null when this run didn't read it.
  const applied = await takeApplied();
  const board = boardOf(feed.jobs, classified);

  const ranAt = new Date().toISOString();
  const result: RunResult = {
    ranAt,
    preset,
    classifier: classifier.name,
    totalScraped: feed.jobs.length,
    totalMatched: kept.length,
    newSinceLastRun: kept.filter((j) => j.isNew).length,
    counts,
    accessLimited: feed.accessLimited,
    boardTotal: feed.boardTotal,
    jobs: kept.map((j) => ({ ...j, description: null })), // descriptions are for classifying only, never saved in run output
    rejected: classified
      .filter((j) => j.icp.decision === "rejected")
      .map((j) => ({ title: j.title, url: j.url, reasons: j.icp.reasons })),
    board,
    ...(applied ? { applied: applied.flatMap((a) => (a.job ? [a.job] : [])) } : {}),
  };

  // The run first: if a later write fails, the ids stay unsaved and the next run re-posts rather than drops.
  await saveRun(result, process.env.RUN_DAILY === "1");
  await addIds("seen_jobs", feed.jobs.filter((j) => !failed.has(j.id)).map((j) => j.id));
  // Jobs applied to on Contra move to the "Applied" stage; a stage set by hand is never overwritten.
  if (applied) {
    try {
      const mark = toMarkApplied(applied, await loadStages());
      const updatedAt = new Date().toISOString();
      for (const a of mark) await saveStageRow({ id: a.id, title: a.title, stage: "applied", updated_at: updatedAt });
      console.log(`[contra] applied sync: ${mark.length} moved to Applied, ${applied.length - mark.length} already staged`);
    } catch (err) {
      console.warn(`[contra] applied sync failed, retried next run: ${err instanceof Error ? err.message : err}`);
    }
  }
  // announced_jobs is written by notify.ts once Slack has accepted the post, so a failed post is retried.
  await rm(RAW_DIR, { recursive: true, force: true }); // consumed; next run starts clean (details stay cached)
  // Only the full feed tells us which jobs are gone; a BOOKMARKED/APPLIED run must not prune the rest.
  if (result.preset === "ALL") {
    const pruned = await pruneDetails(new Set(feed.jobs.map((j) => j.slug)));
    if (pruned) console.log(`[contra] removed ${pruned} cached description(s) for jobs no longer in the feed`);
  }

  const unfiltered = classifier.name === "none";
  const toAnnounce = kept.filter((j) => j.announce);
  const byLane = (["project", "outreach"] as Lane[])
    .map((l) => [l, toAnnounce.filter((j) => j.lane === l).length] as const)
    .filter(([, n]) => n)
    .map(([l, n]) => `${n} ${l}`);
  console.log(
    `[contra] done (${classifier.name}): ${feed.pages} page(s), ${result.totalScraped} jobs → ` +
      (unfiltered ? `${kept.length} listed (ICP filter off)` : `${counts.qualified} qualified, ${counts.maybe} maybe, ${counts.rejected} rejected`) +
      `; ${result.newSinceLastRun} new shown; ${toAnnounce.length} to announce${byLane.length ? ` (${byLane.join(", ")})` : ""}` +
      (feed.accessLimited ? ` (feed is access-limited: board has ${feed.boardTotal ?? "?"} jobs)` : ""),
  );
  for (const j of kept) {
    const tag = unfiltered ? "" : `[${j.icp.decision}${j.icp.tier ? `/${j.icp.tier}` : ""}${j.lane ? ` · ${j.lane}` : ""}${j.announce ? " · announce" : ""}] `;
    console.log(`  ${tag}${j.title}`);
  }
  for (const r of result.rejected) console.log(`  [rejected] ${r.title} — ${r.reasons[0]}`);
}

main().catch((err) => {
  console.error(`[contra] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
