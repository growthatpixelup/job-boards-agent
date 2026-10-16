import { withoutDescription } from "./contra.ts";
import type { BoardJob, ClassifiedJob, Job } from "./types.ts";

/**
 * The whole board for the dashboard's "All jobs" page, in Contra's order: each job's feed record (no description)
 * and the part of its verdict the page shows. Jobs skipped before the AI layer (applied to or dismissed on Contra,
 * filters.ts) have no verdict.
 */
export function boardOf(feed: Job[], classified: ClassifiedJob[]): BoardJob[] {
  const verdictOf = new Map(classified.map((j) => [j.id, j]));
  return feed.map((j) => {
    const c = verdictOf.get(j.id);
    if (!c) return withoutDescription(j);
    const p = c.icp.project;
    const project = p && { scope: p.scope, estimatedValueUsd: p.estimatedValueUsd, fullTime: p.fullTime, concerns: p.concerns };
    return { ...withoutDescription(j), icp: { decision: c.icp.decision, reasons: c.icp.reasons.slice(0, 2), project }, lane: c.lane };
  });
}
