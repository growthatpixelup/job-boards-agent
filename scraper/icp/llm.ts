import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ClientType, GrowthPotential, IcpVerdict, Job } from "../types.ts";
import { icpCriteria } from "./criteria.ts";
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
You see every job on the Contra board, unfiltered, and most are not for us: reject those quickly and save your judgment for the ones that could be.
Decide whether each job qualifies, using only the brief below and the job you are given.

${BRIEF}

Decide on the core ask, the money and whether the client is B2B, not incidental words; otherwise judge the client only for the tier, growth potential and concerns.
Quote short evidence from the job in your reasons. Estimate the hours from what the post actually asks for, not from its title.
Do not assume facts the post does not support: if funding, stage or B2B status isn't stated, treat it as unknown rather than as a positive.
Respond with JSON matching the schema.`;

const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] } as const;

/** The concerns the model can flag (icp-brief.md, "Concerns"), by id, with how Slack and the app show them. */
export const CONCERNS = {
  crypto: "crypto / web3",
  "pre-pmf": "pre-PMF or unfunded",
  agency: "agency / white-label work",
  committee: "RFP or committee buyer",
  "on-site": "on-site or local only",
  "growth-ask": "expects design to drive leads/SEO/ads",
  "cost-shopper": "cost-shopper language",
  "locked-design": "locked brand or finished designs",
} as const;

/** Flag on a job that qualifies although the post doesn't show the client is B2B (client_type "unknown"). */
export const B2B_UNCONFIRMED = "B2B not confirmed";

export const VERDICT_SCHEMA = {
  type: "object",
  // Decision last: the model works out the client, the hours and the money (and its reasons) before it decides.
  properties: {
    client_type: {
      type: "string",
      enum: ["b2b", "b2c", "unknown"],
      description: "Who the client sells to (for agency or white-label work, the end client): see \"The client must be B2B\" in the brief.",
    },
    sprint_types: {
      type: "array",
      items: { type: "string", enum: ["brand", "website", "product-design-dev"] },
      description: "Which kinds of our work the job is; empty if none.",
    },
    scope: { type: "string", description: "One line: the deliverables the post actually asks for." },
    full_time: { type: "boolean", description: "True if the post is for a full-time / in-house role." },
    estimated_hours: {
      type: "number",
      description: "The hours the post states, or else the hours the described scope realistically needs. Always one number (the middle of a range).",
    },
    hourly_rate_usd: {
      ...nullableNumber,
      description: "The stated hourly rate (the middle of a range), or the budget ÷ estimated_hours; null only if no budget is stated.",
    },
    estimated_value_usd: { ...nullableNumber, description: "The total in USD: hourly_rate_usd × estimated_hours; null only if no budget is stated." },
    value_basis: { type: "string", description: "One line: the working, e.g. \"$60/hr × ~80 hrs for a 10-page marketing site\"." },
    growth_potential: {
      type: "string",
      enum: ["high", "medium", "low", "none"],
      description: "How likely this grows into a sprint or retainer (see Growth potential in the brief).",
    },
    growth_path: { type: "string", description: "The likely next steps, e.g. \"logo → brand sprint → marketing site\"; empty if none." },
    concerns: {
      type: "array",
      items: { type: "string", enum: Object.keys(CONCERNS) },
      description: "Ids of the concerns from the brief that apply; empty if none.",
    },
    reasons: { type: "array", items: { type: "string" }, description: "Most important first, each citing evidence from the post." },
    decision: { type: "string", enum: ["qualified", "maybe", "rejected"] },
    tier: { anyOf: [{ type: "string", enum: ["carol", "diana", "eddie"] }, { type: "null" }] },
    confidence: { type: "number", description: "0 to 1" },
  },
  required: [
    "client_type", "sprint_types", "scope", "full_time", "estimated_hours", "hourly_rate_usd", "estimated_value_usd", "value_basis",
    "growth_potential", "growth_path", "concerns", "reasons", "decision", "tier", "confidence",
  ],
  additionalProperties: false,
} as const;

export function jobPrompt(job: Job): string {
  const post = {
    title: job.title,
    client: job.organization?.name ?? null,
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

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const num = (v: unknown, digits = 0) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(digits)) : null);

/** Why a job fails the money rule (icp-brief.md), or null when it meets it. */
export function moneyShortfall(rate: number | null, value: number | null): string | null {
  const C = icpCriteria;
  if (rate == null || value == null) return "the rate or total couldn't be worked out from the post";
  if (rate < C.minHourlyUsd) return `~${usd(rate)}/hr is below the ${usd(C.minHourlyUsd)}/hr minimum`;
  if (value <= C.minProjectUsd) return `~${usd(value)} total isn't more than ${usd(C.minProjectUsd)}`;
  return null;
}

/**
 * The money rule's numbers. The model's judgment is the hours the scope needs; the arithmetic is done here from
 * the posted budget (the middle of its range) where it can be: an hourly job's rate × hours, a fixed budget ÷ hours.
 * Weekly, monthly and full-time pay keep the model's own rate and total.
 */
function money(json: Record<string, unknown>, job?: Job): { rate: number | null; hours: number | null; value: number | null } {
  const hours = num(json.estimated_hours);
  const b = job?.budget;
  const posted = b?.feeMin != null && b.feeMax != null ? (b.feeMin + b.feeMax) / 2 : (b?.feeMax ?? b?.feeMin ?? null);
  if (b?.type === "HOURLY" && posted != null) return { rate: posted, hours, value: hours != null ? Math.round(posted * hours) : null };
  if (b?.type === "FIXED" && posted != null) return { rate: hours ? num(posted / hours, 2) : null, hours, value: Math.round(posted) };
  return { rate: num(json.hourly_rate_usd, 2), hours, value: num(json.estimated_value_usd) };
}

/** `job` (when given) supplies the posted budget, which the money rule is worked out from (see money()). */
export function parseVerdict(text: string, classifier: string, job?: Job): IcpVerdict {
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  let decision = ["qualified", "maybe", "rejected"].includes(json.decision) ? json.decision : "maybe";
  const clientType: ClientType = ["b2b", "b2c", "unknown"].includes(json.client_type) ? json.client_type : "unknown";
  const confidence = Math.min(1, Math.max(0, Number(json.confidence) || 0));
  const growth: GrowthPotential = ["high", "medium", "low", "none"].includes(json.growth_potential) ? json.growth_potential : "none";
  const { rate, hours, value } = money(json, job);
  const ids = [...new Set<string>(Array.isArray(json.concerns) ? json.concerns : [])].filter((c) => Object.hasOwn(CONCERNS, c));
  const concerns: string[] = ids.map((c) => CONCERNS[c as keyof typeof CONCERNS]);
  // B2B only, whatever the model decided: a B2C client is rejected. An unclear one may still qualify, flagged.
  if (clientType === "unknown") concerns.push(B2B_UNCONFIRMED);
  const reasons = [...(json.reasons ?? []), ...concerns.map((c) => `⚠ ${c}`)];
  if (clientType === "b2c" && decision !== "rejected") {
    decision = "rejected";
    reasons.push("⚠ B2C client: we only take B2B clients");
  }
  // The money rule, whatever the model decided: only a job that meets it stays "qualified".
  const shortfall = decision === "qualified" ? moneyShortfall(rate, value) : null;
  if (shortfall) {
    decision = "maybe";
    reasons.push(`⚠ ${shortfall}`);
  }
  const tier = decision !== "rejected" && ["carol", "diana", "eddie"].includes(json.tier) ? json.tier : null;
  return {
    decision,
    tier,
    score: Math.round(confidence * 10),
    reasons,
    signals: [`client:${clientType}`, ...ids.map((c) => `concern:${c}`)],
    classifier,
    project: {
      sprintTypes: Array.isArray(json.sprint_types) ? json.sprint_types : [],
      scope: json.scope ?? "",
      hourlyRateUsd: rate,
      estimatedHours: hours,
      estimatedValueUsd: value,
      basis: json.value_basis ?? "",
      clientType,
      fullTime: json.full_time === true,
      growthPotential: growth,
      growthPath: typeof json.growth_path === "string" ? json.growth_path : "",
      concerns,
    },
  };
}

/**
 * LLM verdicts cached per job, so each job is sent to the model once rather than on every run.
 * Keyed on the exact prompt, so editing the brief or a change to the job re-classifies it.
 * Gitignored; the GitHub workflow keeps it between runs with actions/cache.
 */
export const VERDICTS_DIR = path.resolve(import.meta.dirname, "..", "..", "data", "verdicts");

function promptKey(name: string, user: string): string {
  return createHash("sha256").update(`${name}\n${SYSTEM_PROMPT}\n${user}`).digest("hex");
}

async function readCached(file: string, key: string): Promise<IcpVerdict | null> {
  try {
    const cached = JSON.parse(await readFile(file, "utf8"));
    return cached.key === key ? (cached.verdict as IcpVerdict) : null;
  } catch {
    return null;
  }
}

/** Signal on a verdict whose LLM call failed; the job is retried on the next run. */
export const LLM_FAILED = "llm-failed";

export interface LlmClassifierOptions {
  /** Where to cache verdicts; null disables the cache. Default VERDICTS_DIR. */
  cacheDir?: string | null;
}

/** The LLM judges every job itself: no regex pre-cut. The regex rules only stand in when a call fails. */
export function createLlmClassifier(provider: LlmProvider, name: string, opts: LlmClassifierOptions = {}) {
  const cacheDir = opts.cacheDir === undefined ? VERDICTS_DIR : opts.cacheDir;
  return async (job: Job): Promise<IcpVerdict> => {
    const user = jobPrompt(job);
    const key = promptKey(name, user);
    const file = cacheDir && path.join(cacheDir, `${job.id}.json`);
    if (file) {
      const cached = await readCached(file, key);
      if (cached) return cached;
    }
    try {
      const text = await provider({ system: SYSTEM_PROMPT, user, schema: VERDICT_SCHEMA });
      const verdict = parseVerdict(text, name, job);
      if (cacheDir && file) {
        await mkdir(cacheDir, { recursive: true });
        await writeFile(file, JSON.stringify({ key, verdict }));
      }
      return verdict;
    } catch (err) {
      // Only jobs Claude has read may be "qualified" (and so reach Slack): cap the rubric's verdict at "maybe".
      // run.ts leaves these jobs unseen and unannounced, so the next run retries them.
      const regex = classifyRegex(job);
      return {
        ...regex,
        decision: regex.decision === "qualified" ? "maybe" : regex.decision,
        reasons: [...regex.reasons, `⚠ ${name} failed, not checked by the LLM yet (retried next run): ${(err as Error).message}`],
        signals: [...regex.signals, LLM_FAILED],
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
export function anthropicProvider(model = "claude-sonnet-5-5"): LlmProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  return async ({ system, user, schema }) => {
    if (!client) {
      const { default: Anthropic } = await load("@anthropic-ai/sdk");
      client = new Anthropic();
    }
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      // Re-runs on a fallback model if a safety classifier declines the request.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      // Medium effort: sizing a project from a loose brief needs some thought; classification alone ran fine at low.
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
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
