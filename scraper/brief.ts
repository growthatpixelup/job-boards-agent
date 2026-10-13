import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { LLM_FAILED } from "./icp/llm.ts";
import { isActionable } from "./lanes.ts";
import { mapPool } from "./pool.ts";
import type { ClassifiedJob } from "./types.ts";

// Writes the application brief for each project the team will apply to: the answer to the first field of
// Contra's apply form ("why you'd be a good fit, and any questions"). The form's other two fields need nothing
// from us: Contra fills in the call link, and example projects are picked on Contra. The dashboard's Apply
// button copies the brief. It's written here, during the scrape, because only the scrape has the job's full
// description; the brief itself is our own text with no contact details, and is saved in the run output.

/** Cached briefs, one file per job id, so a job is only written for once (again if the job or pitch.md changes). Gitignored. */
export const BRIEFS_DIR = path.resolve(import.meta.dirname, "..", "data", "briefs");

/** Contra's limit for the field. */
export const MAX_BRIEF_CHARS = 1500;

const PITCH = readFileSync(path.join(import.meta.dirname, "pitch.md"), "utf8");

export const BRIEF_SYSTEM = `You write applications to freelance job posts on Contra for Pixelup Labs, a design studio.
You write the answer to the first field of Contra's application form: "Explain why you'd be a good fit and
include any questions you have." The call link and example projects go in separate fields, so leave them out.

Everything you may say about Pixelup is in this profile:

<profile>
${PITCH}
</profile>

A strong answer:
- Opens with their situation, not with us: show in a sentence or two that we read the post closely (the
  specific thing they're building or fixing, and why it matters to them now).
- Gives our take: the one decision that will make or break this project, said plainly.
- Names one or two clients from the profile closest to this job, with the concrete detail that makes them relevant.
- Lays out what we'd do, in what order and how long it takes, in the post's own words for their deliverables.
- Answers every direct question or request in the post (start date, timeline, process, "tell us about…"). If
  they ask for portfolio pieces, say the most relevant projects are linked below.
- Ends with one sharp question about their project that shows judgment, not a generic "when can we chat?".

Rules:
- Under 1,300 characters. Plain text for a form field: short paragraphs, no markdown, no headings.
- No greeting by name, and never name anyone at the client: we don't know who posted it.
- No links, email addresses, phone numbers, or invitations to talk off Contra.
- Never invent clients, numbers, results or experience that aren't in the profile. If the post is in a domain
  we have no proof for, use the closest analogous work and say so honestly.
- Describe clients only as the profile does: don't add what they make or what industry they're in.
- Don't quote prices or counter their budget unless the post asks for a quote.
- Reply with the answer only, nothing before or after it.`;

/** Projects we apply to on Contra: the same jobs the dashboard and Slack treat as project leads. */
export function needsBrief(job: Pick<ClassifiedJob, "icp" | "lane">): boolean {
  return job.lane === "project" && isActionable(job) && !job.icp.signals.includes(LLM_FAILED);
}

/** The job as the writer sees it. Stable key order, so the cache key only changes when the job does. */
export function briefInput(job: ClassifiedJob): string {
  const p = job.icp.project;
  return JSON.stringify(
    {
      title: job.title,
      client: job.organization?.name ?? (job.hiringAsIndividual ? "an individual" : null),
      budget: job.budget,
      duration: job.duration,
      roles: job.roles,
      tools: job.tools,
      ourRead: p
        ? { scope: p.scope, workTypes: p.sprintTypes, estimatedHours: p.estimatedHours, growthPath: p.growthPath || null, concerns: p.concerns }
        : null,
      description: job.description,
    },
    null,
    2,
  );
}

/** Tidies the model's text for a plain form field: no markdown emphasis or headings, at most one blank line. */
export function cleanBrief(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** What's wrong with a brief, if anything; empty when it can go straight into the form. */
export function briefProblems(brief: string): string[] {
  const problems: string[] = [];
  if (!brief) problems.push("it is empty");
  if (brief.length > MAX_BRIEF_CHARS) problems.push(`it is ${brief.length} characters; Contra allows ${MAX_BRIEF_CHARS}, so cut it to under 1,300`);
  if (/https?:\/\/|www\./i.test(brief)) problems.push("it contains a link; remove it");
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(brief)) problems.push("it contains an email address; remove it");
  return problems;
}

export interface BriefWriter {
  /** Part of the cache key: a different model rewrites the briefs. */
  name: string;
  write(job: ClassifiedJob): Promise<string>;
}

/** Claude, Opus by default. Reads ANTHROPIC_API_KEY (or an `ant auth login` profile). */
export function anthropicBriefWriter(model = "claude-opus-5-5"): BriefWriter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const create = async (messages: any[]): Promise<any> => {
    if (!client) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      client = new Anthropic();
    }
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      // Re-runs on a fallback model if a safety classifier declines the request.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: BRIEF_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
      // A handful of briefs a day, each read by a client deciding whether to hire us: worth the thinking.
      output_config: { effort: "high" },
    });
    if (response.stop_reason === "refusal") throw new Error("Claude declined to write the brief");
    if (response.stop_reason === "max_tokens") throw new Error("the brief ran out of tokens");
    return response;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (content: any[]) => cleanBrief(content.filter((b) => b.type === "text").map((b) => b.text).join(""));

  return {
    name: `anthropic:${model}`,
    async write(job) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages: any[] = [{ role: "user", content: `Write our application for this job:\n\n${briefInput(job)}` }];
      let res = await create(messages);
      let brief = text(res.content);
      let problems = briefProblems(brief);
      if (problems.length) {
        // One revision, in the same conversation (the reply goes back unchanged).
        messages.push({ role: "assistant", content: res.content });
        messages.push({ role: "user", content: `Revise it: ${problems.join("; ")}. Reply with the whole revised answer only.` });
        res = await create(messages);
        brief = text(res.content);
        problems = briefProblems(brief);
      }
      if (problems.length) throw new Error(`brief still unusable after a revision: ${problems.join("; ")}`);
      return brief;
    },
  };
}

/** From env: APPLICATION_BRIEFS=anthropic turns briefs on (BRIEF_MODEL, default claude-opus-5-5); off when unset. */
export function getBriefWriter(env = process.env): BriefWriter | null {
  const kind = (env.APPLICATION_BRIEFS || "").toLowerCase();
  if (!kind || kind === "off" || kind === "none") return null;
  if (kind !== "anthropic") throw new Error(`unknown APPLICATION_BRIEFS "${kind}" (use anthropic, or leave it unset)`);
  return anthropicBriefWriter(env.BRIEF_MODEL || "claude-opus-5-5");
}

/**
 * Sets `applicationBrief` on every project lead: from the cache when the job, pitch.md and model are unchanged,
 * otherwise written fresh. A failed write leaves the job without one; the next run tries again. `feedIds` set:
 * drop cached briefs for jobs no longer in the feed.
 */
export async function addBriefs(
  jobs: ClassifiedJob[],
  writer: BriefWriter | null,
  opts: { dir?: string; feedIds?: Set<string> | null; concurrency?: number } = {},
): Promise<{ written: number; cached: number; failed: number }> {
  const dir = opts.dir ?? BRIEFS_DIR;
  await mkdir(dir, { recursive: true });
  if (opts.feedIds) {
    for (const f of await readdir(dir)) {
      if (f.endsWith(".json") && !opts.feedIds.has(f.slice(0, -5))) await rm(path.join(dir, f), { force: true });
    }
  }
  const counts = { written: 0, cached: 0, failed: 0 };
  await mapPool(jobs.filter(needsBrief), opts.concurrency ?? 3, async (job) => {
    const file = path.join(dir, `${job.id}.json`);
    const key = writer && createHash("sha256").update(`${writer.name}\n${BRIEF_SYSTEM}\n${briefInput(job)}`).digest("hex");
    const cached = await readFile(file, "utf8").then((t) => JSON.parse(t) as { key: string; brief: string }, () => null);
    // Without a writer (local runs), any cached brief beats none.
    if (cached && (!writer || cached.key === key)) {
      job.applicationBrief = cached.brief;
      counts.cached++;
      return;
    }
    if (!writer) return;
    try {
      const brief = await writer.write(job);
      await writeFile(file, JSON.stringify({ key, brief }));
      job.applicationBrief = brief;
      counts.written++;
      console.log(`[contra] brief: ${job.title} (${brief.length} chars)`);
    } catch (err) {
      counts.failed++;
      console.warn(`[contra] brief failed for ${job.title}, retried next run: ${err instanceof Error ? err.message : err}`);
    }
  });
  return counts;
}
