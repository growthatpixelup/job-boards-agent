import { readFileSync } from "node:fs";
import path from "node:path";
import type { IcpVerdict, Job } from "../types.ts";
import { classifyRegex } from "./regex.ts";

/**
 * LLM-backed ICP classifier. Provider-neutral: the prompt, JSON schema and parsing
 * live here; a provider is just "send system + user + schema, return JSON text".
 * Adapters for Claude and OpenAI are below — their SDKs are loaded lazily, so they
 * only need installing when you switch ICP_CLASSIFIER to them.
 */

export type LlmProvider = (req: { system: string; user: string; schema: Record<string, unknown> }) => Promise<string>;

const BRIEF = readFileSync(path.join(import.meta.dirname, "icp-brief.md"), "utf8");

export const SYSTEM_PROMPT = `You qualify freelance job posts from Contra for Pixelup Labs, a design studio.
Decide whether each job fits Pixelup's ideal client profile, using only the brief below and the job you are given.

${BRIEF}

Judge the client (who posted the job) and the core ask, not incidental words. Quote short evidence from the job in your reasons.
Do not assume facts the post does not support: if funding, stage or B2B status isn't stated, treat it as unknown rather than as a positive.
Respond with JSON matching the schema.`;

export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["qualified", "maybe", "rejected"] },
    tier: { anyOf: [{ type: "string", enum: ["carol", "diana", "eddie"] }, { type: "null" }] },
    confidence: { type: "number", description: "0 to 1" },
    reasons: { type: "array", items: { type: "string" }, description: "Most important first, each citing evidence from the post." },
    deal_breakers: { type: "array", items: { type: "string" }, description: "Deal-breakers from the brief that apply; empty if none." },
  },
  required: ["decision", "tier", "confidence", "reasons", "deal_breakers"],
  additionalProperties: false,
} as const;

export function jobPrompt(job: Job): string {
  const post = {
    title: job.title,
    client: job.organization?.name ?? job.owner ?? null,
    clientCountry: job.country,
    postedByIndividual: job.hiringAsIndividual,
    contraRoles: job.roles,
    tools: job.tools,
    budget: job.budget,
    duration: job.duration,
    description: job.description ?? "(description not available)",
  };
  return `Classify this Contra job post:\n\n${JSON.stringify(post, null, 2)}`;
}

export function parseVerdict(text: string, classifier: string): IcpVerdict {
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const decision = ["qualified", "maybe", "rejected"].includes(json.decision) ? json.decision : "maybe";
  const tier = decision !== "rejected" && ["carol", "diana", "eddie"].includes(json.tier) ? json.tier : null;
  const confidence = Math.min(1, Math.max(0, Number(json.confidence) || 0));
  return {
    decision,
    tier,
    score: Math.round(confidence * 10),
    reasons: [...(json.deal_breakers ?? []).map((d: string) => `deal-breaker: ${d}`), ...(json.reasons ?? [])],
    signals: (json.deal_breakers ?? []).map((d: string) => `llm-reject:${d}`),
    classifier,
  };
}

export interface LlmClassifierOptions {
  /** Skip the LLM for jobs the regex classifier hard-rejects (out-of-scope, crypto, budget floor…). Default true. */
  regexPrefilter?: boolean;
}

export function createLlmClassifier(provider: LlmProvider, name: string, opts: LlmClassifierOptions = {}) {
  const prefilter = opts.regexPrefilter ?? true;
  return async (job: Job): Promise<IcpVerdict> => {
    const regex = classifyRegex(job);
    if (prefilter && regex.decision === "rejected") return { ...regex, classifier: `${name} (regex prefilter)` };
    try {
      const text = await provider({ system: SYSTEM_PROMPT, user: jobPrompt(job), schema: VERDICT_SCHEMA });
      return parseVerdict(text, name);
    } catch (err) {
      return {
        ...regex,
        reasons: [...regex.reasons, `⚠ ${name} failed, used regex verdict: ${(err as Error).message}`],
        classifier: `${name} (fell back to regex)`,
      };
    }
  };
}

// ── Providers ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(pkg: string): Promise<any> {
  try {
    return await import(pkg);
  } catch {
    throw new Error(`package "${pkg}" is not installed — run: npm install ${pkg}`);
  }
}

/** Claude via the official SDK. Reads ANTHROPIC_API_KEY (or an `ant auth login` profile). */
export function anthropicProvider(model = "claude-opus-5-5"): LlmProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  return async ({ system, user, schema }) => {
    if (!client) {
      const { default: Anthropic } = await load("@anthropic-ai/sdk");
      client = new Anthropic();
    }
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      // Re-runs on a fallback model if a safety classifier declines the request.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    });
    if (response.stop_reason === "refusal") throw new Error("Claude declined to classify this job");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = response.content.find((b: any) => b.type === "text")?.text;
    if (!text) throw new Error(`no text in Claude response (stop_reason ${response.stop_reason})`);
    return text;
  };
}

/** OpenAI via the official SDK with strict JSON-schema output. Reads OPENAI_API_KEY. */
export function openaiProvider(model: string): LlmProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  return async ({ system, user, schema }) => {
    if (!client) {
      const { default: OpenAI } = await load("openai");
      client = new OpenAI();
    }
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name: "icp_verdict", strict: true, schema } },
    });
    const text = response.choices?.[0]?.message?.content;
    if (!text) throw new Error("no content in OpenAI response");
    return text;
  };
}
