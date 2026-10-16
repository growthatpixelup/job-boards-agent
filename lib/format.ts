import type { Job } from "../scraper/types.ts";

// Small display helpers shared by the dashboard pages.

/** Scrape times in India time, where the team reads them. */
export const ist = (iso: string) =>
  `${new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} IST`;

/** "$4k–$8k fixed", "$50–$100/hr". */
export function formatBudget(b: Job["budget"]): string | null {
  if (!b) return null;
  const range = [b.feeMin, b.feeMax]
    .filter((n) => n != null)
    .map((n) => (n! >= 1000 ? `$${+(n! / 1000).toFixed(1)}k` : `$${n}`))
    .join("–");
  const unit = { FIXED: " fixed", HOURLY: "/hr", WEEKLY: "/wk", MONTHLY: "/mo", UNKNOWN: "" }[b.type];
  return range ? `${range}${unit}` : null;
}

/** "3 months", "2 weeks"; null when Contra gives none. */
export function formatDuration(d: Job["duration"]): string | null {
  if (!d?.amount || !d.interval) return null;
  const unit = d.interval.toLowerCase().replace(/s$/, "");
  return `${d.amount} ${unit}${d.amount === 1 ? "" : "s"}`;
}
