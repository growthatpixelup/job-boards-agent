// "Sync from Contra" on the hosted dashboard: starts the scrape workflow in GitHub Actions and follows the run. The
// run uses the scraper's Contra login from the repo's secrets (Daksh's account), so the refresh token Contra rotates
// on every use stays in one place, and it skips Slack (the next daily scrape posts what it finds).
// Env: GITHUB_DISPATCH_TOKEN, a fine-grained token on the repo with "Actions: read and write";
//      GITHUB_REPO (default growthatpixelup/job-boards-agent, the repo that runs the scrape).

const REPO = process.env.GITHUB_REPO || "growthatpixelup/job-boards-agent";
const WORKFLOW = "scrape.yml";

export const dispatchConfigured = () => !!process.env.GITHUB_DISPATCH_TOKEN;

async function github<T>(path: string, init?: { method: string; body: unknown }): Promise<T | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init ? { "Content-Type": "application/json" } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : ((await res.json()) as T);
}

/** Starts a scrape that skips Slack; returns the request id its run is named after (see run-name in scrape.yml). */
export async function startSync(): Promise<string> {
  const request = crypto.randomUUID().slice(0, 8);
  await github(`/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: { ref: "main", inputs: { notify: "false", request } },
  });
  return request;
}

export const isRequestId = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}$/.test(s);

export type SyncRun =
  /** Not started yet: GitHub hasn't listed it, or it waits behind a scrape already running. */
  | { status: "waiting"; url: string | null }
  | { status: "running"; url: string }
  | { status: "done"; url: string }
  | { status: "failed"; url: string; conclusion: string };

interface WorkflowRun {
  display_title: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

export async function findSync(request: string): Promise<SyncRun> {
  const data = await github<{ workflow_runs: WorkflowRun[] }>(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=20`);
  const run = data?.workflow_runs.find((r) => r.display_title.endsWith(`· ${request}`));
  if (!run) return { status: "waiting", url: null };
  if (run.status === "in_progress") return { status: "running", url: run.html_url };
  if (run.status !== "completed") return { status: "waiting", url: run.html_url };
  return run.conclusion === "success" ? { status: "done", url: run.html_url } : { status: "failed", url: run.html_url, conclusion: run.conclusion ?? "unknown" };
}
