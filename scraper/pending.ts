import { existsSync } from "node:fs";
import { detailFile, loadFeed } from "./feed.ts";
import { matchesFilters } from "./filters.ts";
import { getClassifier, prescreen } from "./icp/index.ts";

// Prints the slugs whose description still needs fetching via the MCP
// (get_job_by_slug), skipping jobs the title/roles/budget prescreen already rejects.
// With ICP_CLASSIFIER=none nothing reads descriptions, so no slugs are printed.

const { jobs, pages } = await loadFeed();
if (!pages) {
  console.error("[contra] no feed pages in data/raw — fetch them with list_job_feed first");
  process.exit(1);
}

if (getClassifier().name === "none") {
  console.error(`[contra] ${jobs.length} jobs: ICP filtering is off, no details needed`);
  console.log("[]");
  process.exit(0);
}

const pending: string[] = [];
let cached = 0;
let skipped = 0;
for (const job of jobs) {
  if (!matchesFilters(job) || !prescreen(job).fetchDetail) skipped++;
  else if (existsSync(detailFile(job.slug))) cached++;
  else pending.push(job.slug);
}

console.error(`[contra] ${jobs.length} jobs: ${pending.length} need details, ${cached} cached, ${skipped} skipped by prescreen`);
console.log(JSON.stringify(pending));
