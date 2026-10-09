import type { BudgetType, Job } from "./types.ts";

// Normalizes `list_job_feed` responses from the Contra MCP server. Claude fetches
// the feed (see .claude/skills/contra-scrape) and saves each raw response page
// to data/raw/ — this module only turns those pages into Job records.

export type FeedPreset = "ALL" | "FOR_YOU" | "BOOKMARKED" | "APPLIED" | "CLOSED" | "NOT_A_FIT";

/** One raw `list_job_feed` response as returned by the MCP tool. */
export interface FeedPage {
  ok?: boolean;
  accessLimitedFeed?: boolean;
  totalCount?: number;
  hasNextPage?: boolean;
  endCursor?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entries?: any[];
}

const BUDGET_TYPES: Record<string, BudgetType> = {
  FixedPriceJobBudget: "FIXED",
  HourlyRateJobBudget: "HOURLY",
  WeeklyRateJobBudget: "WEEKLY",
  MonthlyRateJobBudget: "MONTHLY",
};

/** "USD:1200.00000000" -> 1200 */
function parseMoney(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const n = Number(value.split(":").pop());
  return Number.isFinite(n) ? n : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function names(list: any): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean);
}

/** One raw `get_job_by_slug` response as returned by the MCP tool. */
export interface JobDetail {
  ok?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job?: any;
}

/** Flattens Contra's BlockNote description JSON into plain text, one block per line. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function blocknoteToText(blocks: any): string {
  if (!Array.isArray(blocks)) return typeof blocks === "string" ? blocks : "";
  const lines: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inline = (content: any): string =>
    Array.isArray(content)
      ? content.map((c) => (typeof c?.text === "string" ? c.text : inline(c?.content))).join("")
      : "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (list: any[]) => {
    for (const block of list) {
      const text = inline(block?.content).trim();
      if (text) lines.push(/ListItem$/.test(block?.type ?? "") ? `- ${text}` : text);
      if (Array.isArray(block?.children)) walk(block.children);
    }
  };
  walk(blocks);
  return lines.join("\n");
}

/** Strips email addresses and phone numbers, so no poster contact details are stored. */
export function redactContact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email removed]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (m.replace(/\D/g, "").length >= 8 ? "[phone removed]" : m));
}

/**
 * The only part of a get_job_by_slug response we keep on disk: the description text, with contact
 * details removed. Contra's terms bar storing other users' personal information, so the poster's
 * profile, name and the rest of the raw response are dropped before anything is written.
 */
export function minimalDetail(detail: JobDetail | null | undefined): JobDetail | null {
  const d = detail?.job;
  if (!d || detail?.ok === false) return null;
  return { ok: true, job: { description: redactContact(blocknoteToText(d.blocknoteDescription ?? d.description)) } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalize(entry: any, detail?: JobDetail | null): Job | null {
  const job = entry?.job;
  if (!job?.jobId) return null; // ads and other non-job feed entries
  const description = minimalDetail(detail)?.job.description || null;
  const hiringAsIndividual = !!job.hiringAsIndividual;
  return {
    id: job.jobId,
    title: job.title?.trim() ?? "",
    slug: job.slug,
    url: job.publicUrl ?? `https://contra.com/opportunity/${job.slug}`,
    createdAt: job.createdAt ?? null,
    approvedAt: job.jobPosting?.approvedAt ?? null,
    category: null,
    // Company name only; for a private individual it is often their own name, so drop it. The poster's name is never read.
    organization:
      job.organization && !hiringAsIndividual
        ? { name: job.organization.name?.trim() ?? null, isVerified: !!job.organization.isVerified }
        : null,
    country: (typeof job.country === "string" ? job.country : job.country?.name ?? job.country?.code) ?? null,
    hiringAsIndividual,
    description,
    budget: job.budget
      ? {
          type: BUDGET_TYPES[job.budget.type ?? job.budget.__typename] ?? "UNKNOWN",
          feeMin: parseMoney(job.budget.feeMin),
          feeMax: parseMoney(job.budget.feeMax),
          estimatedHours: job.budget.estimatedHours ?? null,
        }
      : null,
    duration: job.duration
      ? { amount: job.duration.amount ?? null, interval: job.duration.interval ?? null }
      : null,
    roles: names(job.roles),
    tools: names(job.tools),
    timezone: {
      primaryUtcOffset: job.timezonePrimaryUtcOffset ?? null,
      offsetTolerance: job.timezoneOffsetTolerance ?? null,
    },
    visitor: {
      applied: !!entry.visitorDidApply,
      bookmarked: !!entry.visitorDidBookmark,
      dismissed: !!entry.visitorDidDismiss,
      viewed: !!entry.visitorDidView,
      matched: !!entry.visitorWasMatched,
    },
  };
}
