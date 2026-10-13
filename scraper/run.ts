import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, RAW_DIR, loadFeed, minimizeDetails, pruneDetails } from "./feed.ts";
import { filterConfig, matchesFilters } from "./filters.ts";
import { LLM_FAILED, getClassifier } from "./icp/index.ts";
import { toClassified } from "./lanes.ts";
import { LEADS_DIR, getLeadFinder } from "./leads.ts";
import type { ClassifiedJob, IcpDecision, Job, Lane, RunResult } from "./types.ts";

// Ingests the raw MCP feed pages (data/raw/) plus cached descriptions (data/details/)
// saved by the /contra-scrape skill, classifies each job against the ICP, sorts the ones
// that fit into lanes, looks up the companies behind full-time roles, and writes
// data/latest.json for the app.

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const RANK: Record<IcpDecision, number> = { qualified: 0, maybe: 1, rejected: 2 };

/** Adds the company's public links to each announced full-time role; founders go to data/leads/ for the lead sheet. */
async function lookUpLeads(jobs: ClassifiedJob[]): Promise<void> {
  await rm(LEADS_DIR, { recursive: true, force: true }); // only this run's leads; sheet.ts sends them on
  const findLead = getLeadFinder();
  const leads = jobs.filter((j) => j.announce && j.lane === "outreach" && j.organization?.name);
  if (!findLead || !leads.length) return;
  await mkdir(LEADS_DIR, { recursive: true });
  for (const j of leads) {
    try {
      const lead = await findLead(j);
      j.companyLinks = { website: lead.website, linkedin: lead.linkedin, x: lead.x };
      await writeFile(path.join(LEADS_DIR, `${j.id}.json`), JSON.stringify(lead));
      console.log(`[contra] lead: ${j.organization!.name} (${lead.found ? `${lead.confidence} confidence` : "not found"}, ${lead.people.length} people)`);
    } catch (err) {
      console.warn(`[contra] lead lookup failed for ${j.organization!.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function main() {
  await minimizeDetails();
  const feed = await loadFeed();
  if (!feed.pages) {
    throw new Error(`no feed pages in ${RAW_DIR}. Run /contra-scrape in Claude Code to fetch them via the Contra MCP.`);
  }

  const classifier = getClassifier();
  const seenFile = path.join(DATA_DIR, "seen-ids.json");
  const seen = new Set(await readJson<string[]>(seenFile, []));
  // Jobs already posted to Slack, so each is posted once: when it's new, or when a rubric change first qualifies it.
  const announcedFile = path.join(DATA_DIR, "announced-ids.json");
  const announced = new Set(await readJson<string[]>(announcedFile, []));

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
  await lookUpLeads(kept);

  const ranAt = new Date().toISOString();
  const result: RunResult = {
    ranAt,
    preset: process.argv[2] || "ALL",
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
  };

  await mkdir(path.join(DATA_DIR, "runs"), { recursive: true });
  const json = JSON.stringify(result, null, 2);
  // One file per run (UTC date + time), so twice-daily runs don't overwrite each other.
  await writeFile(path.join(DATA_DIR, "runs", `${ranAt.slice(0, 16).replace(":", "")}.json`), json);
  await writeFile(path.join(DATA_DIR, "latest.json"), json);
  for (const j of feed.jobs) if (!failed.has(j.id)) seen.add(j.id);
  await writeFile(seenFile, JSON.stringify([...seen]));
  for (const j of kept) if (j.announce) announced.add(j.id);
  await writeFile(announcedFile, JSON.stringify([...announced]));
  await rm(RAW_DIR, { recursive: true, force: true }); // consumed; next run starts clean (details stay cached)
  // Only the full feed tells us which jobs are gone; a BOOKMARKED/APPLIED run must not prune the rest.
  if (result.preset === "ALL") {
    const pruned = await pruneDetails(new Set(feed.jobs.map((j) => j.slug)));
    if (pruned) console.log(`[contra] removed ${pruned} cached description(s) for jobs no longer in the feed`);
  }

  const unfiltered = classifier.name === "none";
  const toAnnounce = kept.filter((j) => j.announce);
  const byLane = (["sprint", "entry", "outreach"] as Lane[])
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
