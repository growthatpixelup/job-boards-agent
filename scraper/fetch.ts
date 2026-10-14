import { mkdir, rm, writeFile } from "node:fs/promises";
import { DETAILS_DIR, RAW_DIR, detailFile, loadFeed, pendingDetails } from "./feed.ts";
import { minimalDetail } from "./contra.ts";
import { appliedFromPages, saveApplied } from "./applied.ts";
import { ContraMcp, describeAccount, refreshTokens } from "./mcp-client.ts";

// Headless version of the /contra-scrape skill's fetch steps: pulls the job feed (and
// any needed descriptions) straight from Contra's MCP server into data/raw/ and
// data/details/, ready for run.ts. Used by .github/workflows/scrape.yml.
//
// Env: CONTRA_CLIENT_ID, CONTRA_REFRESH_TOKEN (from `npm run contra:auth`)
//      CONTRA_REFRESH_TOKEN_OUT  file to write a rotated refresh token to
//      CONTRA_PRESET (default ALL), CONTRA_MAX_PAGES (default 5)

const { CONTRA_CLIENT_ID, CONTRA_REFRESH_TOKEN, CONTRA_REFRESH_TOKEN_OUT } = process.env;
const preset = process.argv[2] || process.env.CONTRA_PRESET || "ALL";
const maxPages = Number(process.env.CONTRA_MAX_PAGES || 5);

async function main() {
  if (!CONTRA_CLIENT_ID || !CONTRA_REFRESH_TOKEN) {
    throw new Error("CONTRA_CLIENT_ID and CONTRA_REFRESH_TOKEN must be set (run `npm run contra:auth` once to get them)");
  }

  const tokens = await refreshTokens(CONTRA_CLIENT_ID, CONTRA_REFRESH_TOKEN);
  if (tokens.refreshToken !== CONTRA_REFRESH_TOKEN) {
    // Persist before doing anything else: the old token is likely already invalid.
    if (CONTRA_REFRESH_TOKEN_OUT) await writeFile(CONTRA_REFRESH_TOKEN_OUT, tokens.refreshToken, { mode: 0o600 });
    else console.warn("[contra] refresh token was rotated but CONTRA_REFRESH_TOKEN_OUT is not set; the next run will fail");
  }

  const mcp = new ContraMcp(tokens.accessToken);
  await mcp.connect();
  console.log(`[contra] account: ${await describeAccount(mcp)}`);

  await rm(RAW_DIR, { recursive: true, force: true });
  await mkdir(RAW_DIR, { recursive: true });
  let after: string | undefined;
  for (let page = 1; page <= maxPages; page++) {
    const res = await mcp.call("list_job_feed", { preset, first: 100, sort: "NEWEST", ...(after ? { after } : {}) });
    await writeFile(`${RAW_DIR}/page-${page}.json`, JSON.stringify(res));
    console.log(`[contra] page ${page}: ${res.entries?.length ?? 0} entries`);
    if (!res.hasNextPage || !res.endCursor) break;
    after = res.endCursor;
  }

  // Jobs already applied to, so the dashboard can move them to "Applied" (run.ts). Best effort: never fails the scrape.
  if (preset === "ALL") {
    try {
      const pages = [];
      let appliedAfter: string | undefined;
      for (let page = 1; page <= maxPages; page++) {
        const res = await mcp.call("list_job_feed", { preset: "APPLIED", first: 100, sort: "NEWEST", ...(appliedAfter ? { after: appliedAfter } : {}) });
        pages.push(res);
        if (!res.hasNextPage || !res.endCursor) break;
        appliedAfter = res.endCursor;
      }
      const applied = appliedFromPages(pages);
      await saveApplied(applied);
      console.log(`[contra] applied: ${applied.length} job(s)`);
    } catch (err) {
      console.warn(`[contra] applied feed skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  const { pending, summary } = pendingDetails((await loadFeed()).jobs);
  console.log(`[contra] ${summary}`);
  await mkdir(DETAILS_DIR, { recursive: true });
  for (const slug of pending) {
    try {
      const detail = await mcp.call("get_job_by_slug", { slug });
      // Don't cache error responses: a cached file is never re-fetched.
      if (detail?.ok === false) throw new Error(JSON.stringify(detail).slice(0, 200));
      await writeFile(detailFile(slug), JSON.stringify(minimalDetail(detail)));
    } catch (err) {
      console.warn(`[contra] skipped details for ${slug}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch((err) => {
  console.error(`[contra] FETCH FAILED: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1; // not process.exit(): it can crash Node on Windows while sockets close
});
