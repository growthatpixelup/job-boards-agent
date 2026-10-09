import type { BudgetType, IcpDecision, Job } from "./types.ts";

/**
 * Edit this config to control which scraped jobs end up in the list.
 * The ICP rules themselves live in scraper/icp/ (criteria.ts for thresholds,
 * regex.ts for patterns, icp-brief.md for the LLM rubric).
 * A job must pass ALL active rules below AND have an ICP decision in `keepDecisions`.
 */
export const filterConfig = {
  /** ICP decisions to show. Add "rejected" temporarily to audit what the rules drop. */
  keepDecisions: ["qualified", "maybe"] as IcpDecision[],
  /** Keep only jobs whose title/roles/tools/description contain at least one of these (case-insensitive). */
  includeKeywords: [] as string[],
  /** Drop jobs whose title/roles/tools/description contain any of these. */
  excludeKeywords: [] as string[],
  /** Keep only these budget types. Empty = all. */
  budgetTypes: [] as BudgetType[],
  /** Drop jobs posted more than this many days ago. */
  maxAgeDays: null as number | null,
  /** Skip jobs you've already applied to / dismissed on Contra. */
  skipApplied: true,
  skipDismissed: true,
};

function haystack(job: Job): string {
  return [job.title, job.category, ...job.roles, ...job.tools, job.description].filter(Boolean).join(" ").toLowerCase();
}

/** Non-ICP housekeeping filters, applied before classification. */
export function matchesFilters(job: Job, now = new Date()): boolean {
  const c = filterConfig;
  const text = haystack(job);

  if (c.includeKeywords.length && !c.includeKeywords.some((k) => text.includes(k.toLowerCase()))) return false;
  if (c.excludeKeywords.some((k) => text.includes(k.toLowerCase()))) return false;
  if (c.budgetTypes.length && !c.budgetTypes.includes(job.budget?.type ?? "UNKNOWN")) return false;
  if (c.maxAgeDays != null && job.createdAt) {
    const ageDays = (now.getTime() - new Date(job.createdAt).getTime()) / 86_400_000;
    if (ageDays > c.maxAgeDays) return false;
  }
  if (c.skipApplied && job.visitor.applied) return false;
  if (c.skipDismissed && job.visitor.dismissed) return false;
  return true;
}
