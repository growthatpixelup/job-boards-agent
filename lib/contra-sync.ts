import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ContraMcp, refreshTokens } from "../scraper/mcp-client.ts";
import { appliedFromPages, toMarkApplied } from "./applied.ts";
import { loadStages, saveStageRow } from "./db.ts";
import { buildLeads } from "./pipeline.ts";
import { latestRanAt, loadJobStates, loadPipeline } from "./pipeline-store.ts";

// Local-only sync with the Contra account, run from the dashboard's "Sync from Contra" button or `npm run contra:sync`.
// Uses its own login in .contra-auth.json (gitignored; `npm run contra:auth`), not the GitHub Actions one: Contra
// rotates the refresh token on every use, so two places sharing one token would lock each other out.
// Read-only toward Contra; the only writes are stages in Supabase.

const AUTH_FILE = path.resolve(process.cwd(), ".contra-auth.json");
const MAX_PAGES = 5;

/** A get_job_by_slug response for a job that has finished: closed, or past its expiry. */
export function isFinished(detail: { ok?: boolean; job?: { status?: string } } | null | undefined): boolean {
  return detail?.ok !== false && (detail?.job?.status === "CLOSED" || detail?.job?.status === "EXPIRED");
}

export interface SyncResult {
  /** Jobs the account has applied to on Contra. */
  applied: number;
  /** Of those, how many were moved to the Applied stage just now. */
  moved: number;
  /** Open leads (New or Priority) that Contra says have finished, moved to the Closed stage just now. */
  closed: number;
  /** Chat conversations with unread messages (a count only: names and text are never read). */
  unreadConversations: number;
}

async function login(): Promise<ContraMcp> {
  let auth: { CONTRA_CLIENT_ID?: string; CONTRA_REFRESH_TOKEN?: string };
  try {
    auth = JSON.parse(await readFile(AUTH_FILE, "utf8"));
  } catch {
    throw new Error("No local Contra login. Run `npm run contra:auth` and keep the .contra-auth.json it writes (don't use GitHub's copy).");
  }
  if (!auth.CONTRA_CLIENT_ID || !auth.CONTRA_REFRESH_TOKEN) throw new Error(".contra-auth.json is incomplete; run `npm run contra:auth` again");
  const tokens = await refreshTokens(auth.CONTRA_CLIENT_ID, auth.CONTRA_REFRESH_TOKEN);
  // Persist first: the old refresh token is likely already invalid.
  if (tokens.refreshToken !== auth.CONTRA_REFRESH_TOKEN) {
    await writeFile(AUTH_FILE, JSON.stringify({ ...auth, CONTRA_REFRESH_TOKEN: tokens.refreshToken }, null, 2) + "\n", { mode: 0o600 });
  }
  const mcp = new ContraMcp(tokens.accessToken);
  await mcp.connect();
  return mcp;
}

export async function syncFromContra(): Promise<SyncResult> {
  const mcp = await login();

  const pages = [];
  let after: string | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await mcp.call("list_job_feed", { preset: "APPLIED", first: 100, sort: "NEWEST", ...(after ? { after } : {}) });
    pages.push(res);
    if (!res?.hasNextPage || !res.endCursor) break;
    after = res.endCursor;
  }
  const applied = appliedFromPages(pages);
  const mark = toMarkApplied(applied, await loadStages());
  const updatedAt = new Date().toISOString();
  for (const a of mark) await saveStageRow({ id: a.id, title: a.title, stage: "applied", updated_at: updatedAt });

  // Leads still waiting on us (New or Priority) whose job has finished on Contra: nothing left to do, so Closed.
  // Re-read the stages first so a job just moved to Applied above isn't checked. One lookup per lead; a failed
  // lookup leaves the lead alone.
  const lastRun = await latestRanAt();
  const waiting = lastRun
    ? buildLeads(await loadJobStates(), await loadPipeline(), lastRun).filter((l) => l.stage === "new" || l.stage === "priority")
    : [];
  let closed = 0;
  for (const lead of waiting) {
    try {
      if (!isFinished(await mcp.call("get_job_by_slug", { slug: lead.slug }))) continue;
      await saveStageRow({ id: lead.id, title: lead.title.slice(0, 200), stage: "closed", updated_at: new Date().toISOString() });
      closed++;
    } catch (err) {
      console.warn(`[contra] couldn't check "${lead.title}": ${err instanceof Error ? err.message : err}`);
    }
  }

  // A reply from a client is the only status signal Contra gives a freelancer. Failing here must not lose the stage sync.
  let unreadConversations = 0;
  try {
    const chats = await mcp.call("list_chat_conversations", { view: "ALL", first: 50 });
    unreadConversations = (chats?.conversations ?? []).filter((c: { unreadMessageCount?: number }) => (c.unreadMessageCount ?? 0) > 0).length;
  } catch (err) {
    console.warn(`[contra] inbox check skipped: ${err instanceof Error ? err.message : err}`);
  }

  return { applied: applied.length, moved: mark.length, closed, unreadConversations };
}

/** One line for a toast or the terminal. */
export function describeSync(r: SyncResult): string {
  const parts = [
    r.moved ? `${r.moved} job${r.moved === 1 ? "" : "s"} moved to Applied` : "Applied stages already up to date",
    `${r.applied} applied on Contra`,
  ];
  if (r.closed) parts.push(`${r.closed} closed on Contra`);
  if (r.unreadConversations) parts.push(`${r.unreadConversations} unread conversation${r.unreadConversations === 1 ? "" : "s"} on Contra`);
  return parts.join(" · ");
}
