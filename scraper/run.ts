import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, RAW_DIR, loadFeed } from "./feed.ts";
import { filterConfig, matchesFilters } from "./filters.ts";
import { getClassifier } from "./icp/index.ts";
import type { ClassifiedJob, IcpDecision, Job, RunResult } from "./types.ts";

// Ingests the raw MCP feed pages (data/raw/) plus cached descriptions (data/details/)
// saved by the /contra-scrape skill, classifies each job against the ICP, and
// writes data/latest.json for the app.

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

async function main() {
  const feed = await loadFeed();
  if (!feed.pages) {
    throw new Error(`no feed pages in ${RAW_DIR}. Run /contra-scrape in Claude Code to fetch them via the Contra MCP.`);
  }

  const classifier = getClassifier();
  const seenFile = path.join(DATA_DIR, "seen-ids.json");
  const seen = new Set(await readJson<string[]>(seenFile, []));

  const candidates = feed.jobs.filter((j) => matchesFilters(j));
  const verdicts = await mapPool(candidates, classifier.concurrency, (j: Job) => classifier.classify(j));
  const classified: ClassifiedJob[] = candidates.map((j, i) => ({ ...j, isNew: !seen.has(j.id), icp: verdicts[i] }));

  const counts: Record<IcpDecision, number> = { qualified: 0, maybe: 0, rejected: 0 };
  for (const j of classified) counts[j.icp.decision]++;

  const kept = classified.filter((j) => filterConfig.keepDecisions.includes(j.icp.decision));
  kept.sort(
    (a, b) =>
      RANK[a.icp.decision] - RANK[b.icp.decision] ||
      Number(b.isNew) - Number(a.isNew) ||
      b.icp.score - a.icp.score ||
      (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );

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
    jobs: kept,
    rejected: classified
      .filter((j) => j.icp.decision === "rejected")
      .map((j) => ({ title: j.title, url: j.url, reasons: j.icp.reasons })),
  };

  await mkdir(path.join(DATA_DIR, "runs"), { recursive: true });
  const json = JSON.stringify(result, null, 2);
  await writeFile(path.join(DATA_DIR, "runs", `${ranAt.slice(0, 10)}.json`), json);
  await writeFile(path.join(DATA_DIR, "latest.json"), json);
  for (const j of feed.jobs) seen.add(j.id);
  await writeFile(seenFile, JSON.stringify([...seen]));
  await rm(RAW_DIR, { recursive: true, force: true }); // consumed; next run starts clean (details stay cached)

  const unfiltered = classifier.name === "none";
  console.log(
    `[contra] done (${classifier.name}): ${feed.pages} page(s), ${result.totalScraped} jobs → ` +
      (unfiltered ? `${kept.length} listed (ICP filter off)` : `${counts.qualified} qualified, ${counts.maybe} maybe, ${counts.rejected} rejected`) +
      `; ${result.newSinceLastRun} new shown` +
      (feed.accessLimited ? ` (feed is access-limited: board has ${feed.boardTotal ?? "?"} jobs)` : ""),
  );
  for (const j of kept) console.log(unfiltered ? `  ${j.title}` : `  [${j.icp.decision}${j.icp.tier ? `/${j.icp.tier}` : ""}] ${j.title}`);
  for (const r of result.rejected) console.log(`  [rejected] ${r.title} — ${r.reasons[0]}`);
}

main().catch((err) => {
  console.error(`[contra] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
