import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunResult } from "../scraper/types.ts";
import { parsePipeline, serializePipeline, setStage, type Pipeline, type Stage } from "./pipeline.ts";

// Where the dashboard reads scrape data and saves stages. Locally (npm run dev) that's the data/ folder: stage
// changes go straight into data/pipeline.json; commit it like any other change. A hosted copy (Vercel) has no
// data/ folder and can't keep files, so with DASHBOARD_GITHUB_TOKEN set it reads data/ from the repo through the
// GitHub API on every visit (always the latest scrape, no redeploy) and commits each stage change to
// data/pipeline.json there.

const DATA = path.join(process.cwd(), "data");
const PIPELINE_PATH = "data/pipeline.json";

const github = process.env.DASHBOARD_GITHUB_TOKEN
  ? {
      token: process.env.DASHBOARD_GITHUB_TOKEN,
      repo: process.env.DASHBOARD_GITHUB_REPO ?? "PIXELUPLABS/contra-scrapper",
      branch: process.env.DASHBOARD_GITHUB_BRANCH ?? "main",
    }
  : null;

export const readsFromGitHub = github != null;

/** Running on Vercel without a token: there's no data to show yet. */
export const missingGitHubToken = !github && !!process.env.VERCEL;

function githubRequest(apiPath: string, init: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<Response> {
  return fetch(`https://api.github.com/repos/${github!.repo}/${apiPath}`, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${github!.token}`,
      Accept: init.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

async function githubText(apiPath: string): Promise<string | null> {
  const res = await githubRequest(apiPath, { raw: true });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub: reading ${apiPath} failed (${res.status})`);
  return res.text();
}

// A run file never changes once written, so each is fetched once per server instance, keyed by its blob sha.
const runsBySha = new Map<string, RunResult>();

async function loadRunsFromGitHub(): Promise<RunResult[]> {
  const res = await githubRequest(`contents/data/runs?ref=${github!.branch}`);
  if (!res.ok && res.status !== 404) throw new Error(`GitHub: listing data/runs failed (${res.status})`);
  const files = res.status === 404 ? [] : ((await res.json()) as { name: string; sha: string; type: string }[]);
  return Promise.all(
    files
      .filter((f) => f.type === "file" && f.name.endsWith(".json"))
      .map(async (f) => {
        let run = runsBySha.get(f.sha);
        if (!run) {
          run = JSON.parse((await githubText(`git/blobs/${f.sha}`))!) as RunResult;
          runsBySha.set(f.sha, run);
        }
        return run;
      }),
  );
}

/** The latest scrape (data/latest.json). */
export async function loadLatest(): Promise<RunResult | null> {
  const text = github
    ? await githubText(`contents/data/latest.json?ref=${github.branch}`)
    : await readFile(path.join(DATA, "latest.json"), "utf8").catch(() => null);
  return text ? (JSON.parse(text) as RunResult) : null;
}

/** Every saved run and latest.json (it may be newer than the last file in runs/). */
export async function loadRuns(): Promise<RunResult[]> {
  let runs: RunResult[];
  if (github) {
    runs = await loadRunsFromGitHub();
  } else {
    const dir = path.join(DATA, "runs");
    const files = await readdir(dir).catch(() => [] as string[]);
    runs = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map((f) => readFile(path.join(dir, f), "utf8").then((t) => JSON.parse(t) as RunResult, () => null)),
    ).then((rs) => rs.filter((r): r is RunResult => r != null));
  }
  const latest = await loadLatest();
  return [...runs, ...(latest ? [latest] : [])].filter((r) => Array.isArray(r.jobs));
}

async function readPipelineFromGitHub(): Promise<{ pipeline: Pipeline; sha: string | null }> {
  const res = await githubRequest(`contents/${PIPELINE_PATH}?ref=${github!.branch}`);
  if (res.status === 404) return { pipeline: parsePipeline(null), sha: null };
  if (!res.ok) throw new Error(`GitHub: reading ${PIPELINE_PATH} failed (${res.status})`);
  const file = (await res.json()) as { content: string; sha: string };
  return { pipeline: parsePipeline(Buffer.from(file.content, "base64").toString("utf8")), sha: file.sha };
}

export async function loadPipeline(): Promise<Pipeline> {
  if (github) return (await readPipelineFromGitHub()).pipeline;
  return parsePipeline(await readFile(path.join(DATA, "pipeline.json"), "utf8").catch(() => null));
}

export async function saveStage(id: string, title: string, stage: Stage): Promise<void> {
  if (!github) {
    if (process.env.VERCEL) throw new Error("Set DASHBOARD_GITHUB_TOKEN to save stages on Vercel");
    const file = path.join(DATA, "pipeline.json");
    const current = parsePipeline(await readFile(file, "utf8").catch(() => null));
    await writeFile(file, serializePipeline(setStage(current, id, title, stage)));
    return;
  }
  // Someone else may have committed in between (another stage change or a teammate); re-read and retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { pipeline, sha } = await readPipelineFromGitHub();
    const res = await githubRequest(`contents/${PIPELINE_PATH}`, {
      method: "PUT",
      body: {
        message: `pipeline: ${title} → ${stage}`,
        content: Buffer.from(serializePipeline(setStage(pipeline, id, title, stage))).toString("base64"),
        branch: github.branch,
        ...(sha ? { sha } : {}),
      },
    });
    if (res.ok) return;
    if (res.status !== 409 && res.status !== 422) throw new Error(`GitHub: saving ${PIPELINE_PATH} failed (${res.status})`);
  }
  throw new Error(`GitHub: ${PIPELINE_PATH} kept changing; try again`);
}
