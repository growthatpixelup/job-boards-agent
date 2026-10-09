import type { IcpVerdict, Job } from "../types.ts";
import { anthropicProvider, createLlmClassifier, openaiProvider } from "./llm.ts";
import { classifyRegex } from "./regex.ts";

export interface IcpClassifier {
  name: string;
  classify(job: Job): Promise<IcpVerdict>;
  /** How many jobs to classify at once. */
  concurrency: number;
}

/**
 * Picks the classifier from env:
 *   ICP_CLASSIFIER=none       (default) no ICP filtering: every job is kept, no descriptions fetched
 *   ICP_CLASSIFIER=regex      free, deterministic rules in regex.ts
 *   ICP_CLASSIFIER=anthropic  ICP_MODEL defaults to claude-opus-5-5; needs `npm i @anthropic-ai/sdk` + ANTHROPIC_API_KEY
 *   ICP_CLASSIFIER=openai     ICP_MODEL required;                     needs `npm i openai` + OPENAI_API_KEY
 * LLM classifiers run the regex classifier first and skip jobs it hard-rejects
 * (set ICP_LLM_PREFILTER=false to send every job to the LLM).
 */
export function getClassifier(env = process.env): IcpClassifier {
  const kind = (env.ICP_CLASSIFIER || "none").toLowerCase();
  const regexPrefilter = env.ICP_LLM_PREFILTER !== "false";

  if (kind === "none") {
    const verdict: IcpVerdict = { decision: "qualified", tier: null, score: 0, reasons: [], signals: [], classifier: "none" };
    return { name: "none", concurrency: 50, classify: async () => verdict };
  }

  if (kind === "regex") return { name: "regex", concurrency: 50, classify: async (job) => classifyRegex(job) };

  if (kind === "anthropic" || kind === "claude") {
    const model = env.ICP_MODEL || "claude-opus-5-5";
    const name = `anthropic:${model}`;
    return { name, concurrency: 4, classify: createLlmClassifier(anthropicProvider(model), name, { regexPrefilter }) };
  }

  if (kind === "openai") {
    const model = env.ICP_MODEL;
    if (!model) throw new Error("ICP_CLASSIFIER=openai needs ICP_MODEL set to an OpenAI model id");
    const name = `openai:${model}`;
    return { name, concurrency: 4, classify: createLlmClassifier(openaiProvider(model), name, { regexPrefilter }) };
  }

  throw new Error(`unknown ICP_CLASSIFIER "${kind}" (use regex | anthropic | openai)`);
}

export { classifyRegex, prescreen } from "./regex.ts";
