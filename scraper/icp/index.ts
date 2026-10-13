import type { IcpVerdict, Job } from "../types.ts";
import { anthropicProvider, createLlmClassifier, openaiProvider } from "./llm.ts";
import { classifyRegex, prescreen } from "./regex.ts";

export interface IcpClassifier {
  name: string;
  classify(job: Job): Promise<IcpVerdict>;
  /** Whether classify() needs the job's description, so the fetch step knows which to get with get_job_by_slug. */
  needsDetail(job: Job): boolean;
  /** How many jobs to classify at once. */
  concurrency: number;
}

/**
 * Picks the classifier from env:
 *   ICP_CLASSIFIER=none       no ICP filtering: every job is kept, no descriptions fetched
 *   ICP_CLASSIFIER=regex      (default) free, deterministic rules in regex.ts
 *   ICP_CLASSIFIER=anthropic  ICP_MODEL defaults to claude-sonnet-5-5; needs ANTHROPIC_API_KEY
 *   ICP_CLASSIFIER=openai     ICP_MODEL required; needs `npm i openai` + OPENAI_API_KEY
 * LLM classifiers are the one evaluation layer: they read every job, with its description. The regex rules
 * only stand in, capped at "maybe", when an LLM call fails.
 */
export function getClassifier(env = process.env): IcpClassifier {
  const kind = (env.ICP_CLASSIFIER || "regex").toLowerCase();

  if (kind === "none") {
    const verdict: IcpVerdict = { decision: "qualified", tier: null, score: 0, reasons: [], signals: [], classifier: "none" };
    return { name: "none", concurrency: 50, needsDetail: () => false, classify: async () => verdict };
  }

  if (kind === "regex") {
    return { name: "regex", concurrency: 50, needsDetail: (job) => prescreen(job).fetchDetail, classify: async (job) => classifyRegex(job) };
  }

  if (kind === "anthropic" || kind === "claude") {
    const model = env.ICP_MODEL || "claude-sonnet-5-5";
    const name = `anthropic:${model}`;
    return { name, concurrency: 8, needsDetail: () => true, classify: createLlmClassifier(anthropicProvider(model), name) };
  }

  if (kind === "openai") {
    const model = env.ICP_MODEL;
    if (!model) throw new Error("ICP_CLASSIFIER=openai needs ICP_MODEL set to an OpenAI model id");
    const name = `openai:${model}`;
    return { name, concurrency: 8, needsDetail: () => true, classify: createLlmClassifier(openaiProvider(model), name) };
  }

  throw new Error(`unknown ICP_CLASSIFIER "${kind}" (use regex | anthropic | openai)`);
}

export { classifyRegex, prescreen } from "./regex.ts";
export { LLM_FAILED } from "./llm.ts";
