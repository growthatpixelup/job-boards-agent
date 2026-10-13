import path from "node:path";
import type { ClassifiedJob, CompanyLinks } from "./types.ts";

// Finds the public website, LinkedIn page and X account of the company behind a full-time role, plus its
// founders, with Claude and web search. Only the company is looked up: nothing about the Contra poster is
// read, and contra.com is blocked from the search. Founders' details go only to the lead sheet (sheet.ts)
// through data/leads/, which is gitignored and never committed.

/** This run's lookups, one file per job id, read by sheet.ts. Gitignored. */
export const LEADS_DIR = path.resolve(import.meta.dirname, "..", "data", "leads");

export interface LeadPerson {
  name: string;
  role: string;
  linkedin: string | null;
  x: string | null;
}

export interface Lead extends CompanyLinks {
  /** Whether the right company was identified. */
  found: boolean;
  people: LeadPerson[];
  confidence: "high" | "medium" | "low";
  notes: string;
}

export type LeadFinder = (job: ClassifiedJob) => Promise<Lead>;

/**
 * Web search plus web fetch, to read the company's own site. contra.com is blocked from both: Contra data
 * only ever comes through Contra's MCP. Both run directly; a company lookup doesn't need dynamic filtering.
 */
export const LEAD_TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 8, blocked_domains: ["contra.com"], allowed_callers: ["direct"] },
  {
    type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, max_content_tokens: 12_000,
    blocked_domains: ["contra.com"], allowed_callers: ["direct"],
  },
] as const;

const RESEARCH_PROMPT = `You research companies for Pixelup Labs, a design studio, so its founders can pitch them directly.
The company you're given posted a full-time design or development role. Find it on the public web:
- its official website
- its LinkedIn company page
- its X (Twitter) account
- its founders; failing that, its CEO and its head of design or product (name, role, LinkedIn profile, X profile)
Find the website first, then open it: its header and footer usually link its LinkedIn and X, and its about or
team page names the founders. Search LinkedIn, X, Crunchbase and press coverage for what the site doesn't show.
Use public professional sources only. Don't look for or report emails, phone numbers, home addresses or other personal details.
Several companies can share a name: use the job details to pick the right one, and say how sure you are.
Only report URLs that appeared in your search results or on pages you opened; never guess one.`;

const url = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

export const LEAD_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean", description: "True if the notes identify the company that posted the job." },
    website: url,
    linkedin: { ...url, description: "LinkedIn company page URL" },
    x: { ...url, description: "The company's X/Twitter profile URL" },
    people: {
      type: "array",
      description: "Founders or senior leaders, at most 3.",
      items: {
        type: "object",
        properties: { name: { type: "string" }, role: { type: "string" }, linkedin: url, x: url },
        required: ["name", "role", "linkedin", "x"],
        additionalProperties: false,
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"], description: "How sure the notes are that this is the right company." },
    notes: { type: "string", description: "One line: how the company was identified, or why it couldn't be." },
  },
  required: ["found", "website", "linkedin", "x", "people", "confidence", "notes"],
  additionalProperties: false,
} as const;

type LinkKind = "website" | "linkedin-company" | "linkedin-person" | "x";

const isOn = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** The URL if it's a well-formed http(s) link of the expected kind, never a contra.com one; else null. */
function link(value: unknown, kind: LinkKind): string | null {
  if (typeof value !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!/^https?:$/.test(parsed.protocol) || isOn(host, "contra.com")) return null;
  const social = ["linkedin.com", "x.com", "twitter.com"].some((d) => isOn(host, d));
  const ok = {
    website: !social,
    "linkedin-company": isOn(host, "linkedin.com") && /^\/(company|showcase)\/[^/]+/.test(parsed.pathname),
    "linkedin-person": isOn(host, "linkedin.com") && /^\/in\/[^/]+/.test(parsed.pathname),
    x: (isOn(host, "x.com") || isOn(host, "twitter.com")) && /^\/\w{1,15}\/?$/.test(parsed.pathname),
  }[kind];
  return ok ? parsed.href : null;
}

/** Validates the model's JSON: drops links that aren't what they claim to be, keeps at most 3 people. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cleanLead(raw: any): Lead {
  const people: LeadPerson[] = (Array.isArray(raw?.people) ? raw.people : [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((p: any) => typeof p?.name === "string" && p.name.trim())
    .slice(0, 3)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any) => ({
      name: p.name.trim(),
      role: typeof p.role === "string" ? p.role.trim() : "",
      linkedin: link(p.linkedin, "linkedin-person"),
      x: link(p.x, "x"),
    }));
  return {
    found: raw?.found === true,
    website: link(raw?.website, "website"),
    linkedin: link(raw?.linkedin, "linkedin-company"),
    x: link(raw?.x, "x"),
    people,
    confidence: ["high", "medium", "low"].includes(raw?.confidence) ? raw.confidence : "low",
    notes: typeof raw?.notes === "string" ? raw.notes.trim() : "",
  };
}

/** Claude with web search. Reads ANTHROPIC_API_KEY (or an `ant auth login` profile). */
export function anthropicLeadFinder(model = "claude-sonnet-5-5"): LeadFinder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const create = async (params: Record<string, unknown>): Promise<any> => {
    if (!client) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      client = new Anthropic();
    }
    const response = await client.beta.messages.create({
      model,
      // Re-runs on a fallback model if a safety classifier declines the request.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      ...params,
    });
    if (response.stop_reason === "refusal") throw new Error("Claude declined the lookup");
    return response;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (content: any[]) => content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();

  return async (job) => {
    const company = job.organization?.name;
    if (!company) throw new Error("no company name to look up");
    const post = { company, clientCountry: job.country, role: job.title, description: job.description?.slice(0, 4000) ?? null };

    // 1. Research with web search. A long search turn can pause; sending it back lets it continue.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [{ role: "user", content: `Find this company:\n\n${JSON.stringify(post, null, 2)}` }];
    let notes = "";
    for (let turn = 0; turn < 4; turn++) {
      const res = await create({
        max_tokens: 16000,
        system: RESEARCH_PROMPT,
        messages,
        tools: LEAD_TOOLS,
        output_config: { effort: "medium" },
      });
      notes = text(res.content);
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content });
    }
    if (!notes) throw new Error("the web search returned no findings");

    // 2. Web search answers carry citations, which can't be combined with structured outputs: a second,
    // tool-free call turns the notes into JSON.
    const res = await create({
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content:
            `Turn these research notes about ${company} into JSON matching the schema. Use only what the notes say. ` +
            `List in people only those the notes identify as founders or senior leaders of this company (CEO, CTO, ` +
            `head of design or product); leave it empty otherwise.\n\n${notes}`,
        },
      ],
      output_config: { effort: "low", format: { type: "json_schema", schema: LEAD_SCHEMA } },
    });
    return cleanLead(JSON.parse(text(res.content)));
  };
}

/** From env: LEAD_LOOKUP=anthropic turns the lookup on (LEAD_MODEL, default claude-sonnet-5-5); off when unset. */
export function getLeadFinder(env = process.env): LeadFinder | null {
  const kind = (env.LEAD_LOOKUP || "").toLowerCase();
  if (!kind || kind === "off" || kind === "none") return null;
  if (kind !== "anthropic") throw new Error(`unknown LEAD_LOOKUP "${kind}" (use anthropic, or leave it unset)`);
  return anthropicLeadFinder(env.LEAD_MODEL || "claude-sonnet-5-5");
}
