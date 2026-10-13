import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunResult } from "../scraper/types.ts";
import { parsePipeline, serializePipeline, setStage, type Pipeline, type Stage } from "./pipeline.ts";

// Where stages are saved. Locally (npm run dev) they go straight into data/pipeline.json; commit it like any
// other change. On a hosted copy the file system is read-only and resets on deploy, so with PIPELINE_GITHUB_TOKEN
// set each stage change is committed to data/pipeline.json in the repo through the GitHub API instead.

const DATA = path.join(process.cwd(), "data");
const PIPELINE_PATH = "data/pipeline.json";

const github = process.env.PIPELINE_GITHUB_TOKEN
  ? {
      token: process.env.PIPELINE_GITHUB_TOKEN,
      repo: process.env.PIPELINE_GITHUB_REPO ?? "PIXELUPLABS/contra-scrapper",
      branch: process.env.PIPELINE_GITHUB_BRANCH ?? "main",
    }
  : null;

export const savesToGitHub = github != null;

/** Every saved run, oldest first, and latest.json (it may be newer than the last file in runs/). */
export async function loadRuns(): Promise<RunResult[]> {
  const dir = path.join(DATA, "runs");
  const files = await readdir(dir).catch(() => [] as string[]);
  const runs = await Promise.all(
    [...files.filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f)), path.join(DATA, "latest.json")].map(
      (f) => readFile(f, "utf8").then((t) => JSON.parse(t) as RunResult, () => null),
    ),
  );
  return runs.filter((r): r is RunResult => r != null && Array.isArray(r.jobs));
}

async function githubRequest(method: string, body?: unknown): Promise<Response> {
  const url = `https://api.github.com/repos/${github!.repo}/contents/${PIPELINE_PATH}` + (method === "GET" ? `?ref=${github!.branch}` : "");
  return fetch(url, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${github!.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function readFromGitHub(): Promise<{ pipeline: Pipeline; sha: string | null }> {
  const res = await githubRequest("GET");
  if (res.status === 404) return { pipeline: parsePipeline(null), sha: null };
  if (!res.ok) throw new Error(`GitHub: reading ${PIPELINE_PATH} failed (${res.status})`);
  const file = (await res.json()) as { content: string; sha: string };
  return { pipeline: parsePipeline(Buffer.from(file.content, "base64").toString("utf8")), sha: file.sha };
}

export async function loadPipeline(): Promise<Pipeline> {
  if (github) return (await readFromGitHub()).pipeline;
  return parsePipeline(await readFile(path.join(DATA, "pipeline.json"), "utf8").catch(() => null));
}

export async function saveStage(id: string, title: string, stage: Stage): Promise<void> {
  if (!github) {
    const file = path.join(DATA, "pipeline.json");
    const current = parsePipeline(await readFile(file, "utf8").catch(() => null));
    await writeFile(file, serializePipeline(setStage(current, id, title, stage)));
    return;
  }
  // Someone else may have committed in between (another stage change or a teammate); re-read and retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { pipeline, sha } = await readFromGitHub();
    const res = await githubRequest("PUT", {
      message: `pipeline: ${title} → ${stage}`,
      content: Buffer.from(serializePipeline(setStage(pipeline, id, title, stage))).toString("base64"),
      branch: github.branch,
      ...(sha ? { sha } : {}),
    });
    if (res.ok) return;
    if (res.status !== 409 && res.status !== 422) throw new Error(`GitHub: saving ${PIPELINE_PATH} failed (${res.status})`);
  }
  throw new Error(`GitHub: ${PIPELINE_PATH} kept changing; try again`);
}
