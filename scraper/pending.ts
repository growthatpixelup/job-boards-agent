import { loadFeed, pendingDetails } from "./feed.ts";

// Prints the slugs whose description still needs fetching via the MCP
// (get_job_by_slug): every uncached job for an LLM classifier, which reads them all; for the
// regex classifier, only jobs the title/roles/budget prescreen doesn't already reject.
// With ICP_CLASSIFIER=none nothing reads descriptions, so no slugs are printed.

const { jobs, pages } = await loadFeed();
if (!pages) {
  console.error("[contra] no feed pages in data/raw — fetch them with list_job_feed first");
  process.exit(1);
}

const { pending, summary } = pendingDetails(jobs);
console.error(`[contra] ${summary}`);
console.log(JSON.stringify(pending));
