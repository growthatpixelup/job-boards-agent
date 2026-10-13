import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { minimalDetail, normalize, type FeedPage, type JobDetail } from "./contra.ts";
import { matchesFilters } from "./filters.ts";
import { getClassifier } from "./icp/index.ts";
import type { Job } from "./types.ts";

export const DATA_DIR = path.resolve(import.meta.dirname, "..", "data");
/** Raw list_job_feed pages for the current run (deleted after ingest). */
export const RAW_DIR = path.join(DATA_DIR, "raw");
/**
 * Cached job descriptions, one file per slug, so runs only fetch new ones. Holds only the
 * contact-redacted description text (see minimalDetail). Gitignored; the GitHub workflow keeps
 * it between runs with actions/cache instead of committing it.
 */
export const DETAILS_DIR = path.join(DATA_DIR, "details");

export const detailFile = (slug: string) => path.join(DETAILS_DIR, `${slug}.json`);

async function readJsonFiles<T>(dir: string): Promise<Map<string, T>> {
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  const out = new Map<string, T>();
  for (const f of files) out.set(f.slice(0, -5), JSON.parse(await readFile(path.join(dir, f), "utf8")) as T);
  return out;
}

export interface Feed {
  pages: number;
  jobs: Job[];
  accessLimited: boolean;
  boardTotal: number | null;
}

/** Normalizes the saved feed pages, attaching cached descriptions where available. */
export async function loadFeed(): Promise<Feed> {
  const pages = await readJsonFiles<FeedPage>(RAW_DIR);
  const details = await readJsonFiles<JobDetail>(DETAILS_DIR);
  const jobs = new Map<string, Job>();
  let accessLimited = false;
  let boardTotal: number | null = null;

  for (const [name, page] of pages) {
    if (page.ok === false) throw new Error(`${name}.json is an error response from the MCP`);
    accessLimited ||= !!page.accessLimitedFeed;
    boardTotal ??= page.totalCount ?? null;
    for (const entry of page.entries ?? []) {
      const detail = details.get(entry?.job?.slug);
      const job = normalize(entry, detail?.ok === false ? null : detail);
      if (job) jobs.set(job.id, job);
    }
  }
  return { pages: pages.size, jobs: [...jobs.values()], accessLimited, boardTotal };
}

/**
 * Slugs whose description still needs a get_job_by_slug call: every job an LLM classifier will read, or
 * only those the title/roles/budget prescreen keeps for the regex classifier (none when ICP filtering is off).
 */
export function pendingDetails(jobs: Job[]): { pending: string[]; summary: string } {
  const classifier = getClassifier();
  if (classifier.name === "none") {
    return { pending: [], summary: `${jobs.length} jobs: ICP filtering is off, no details needed` };
  }
  const pending: string[] = [];
  let cached = 0;
  let skipped = 0;
  for (const job of jobs) {
    if (!matchesFilters(job) || !classifier.needsDetail(job)) skipped++;
    else if (existsSync(detailFile(job.slug))) cached++;
    else pending.push(job.slug);
  }
  return { pending, summary: `${jobs.length} jobs: ${pending.length} need details, ${cached} cached, ${skipped} not needed` };
}

/** Rewrites any cached detail still holding a full MCP response (the /contra-scrape skill saves them verbatim) down to the description only. */
export async function minimizeDetails(dir = DETAILS_DIR): Promise<void> {
  for (const [slug, detail] of await readJsonFiles<JobDetail>(dir)) {
    const min = minimalDetail(detail);
    if (!min) await rm(path.join(dir, `${slug}.json`), { force: true });
    else if (JSON.stringify(min) !== JSON.stringify(detail)) await writeFile(path.join(dir, `${slug}.json`), JSON.stringify(min));
  }
}

/** Deletes cached descriptions for jobs no longer in the feed, so data/details/ stays small. Returns the count removed. */
export async function pruneDetails(keepSlugs: Set<string>, dir = DETAILS_DIR): Promise<number> {
  const stale = (await readdir(dir).catch(() => [] as string[])).filter(
    (f) => f.endsWith(".json") && !keepSlugs.has(f.slice(0, -5)),
  );
  await Promise.all(stale.map((f) => rm(path.join(dir, f), { force: true })));
  return stale.length;
}
