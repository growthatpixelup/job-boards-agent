import type { BudgetType } from "../types.ts";

/**
 * Tunable numbers for the ICP classifiers. The qualitative rules live in
 * icp-brief.md (LLM rubric) and regex.ts (regex patterns) — keep all three in sync.
 */
export const icpCriteria = {
  /**
   * Budget thresholds in whole USD, compared against the job's max fee (or min when no max).
   * Below `floor` = cost-shopper → rejected. Between floor and `target` = capped at "maybe".
   * At/above `target` = budget fits. `premium` and up earns an extra point.
   */
  budget: {
    FIXED: { floor: 5_000, target: 10_000, premium: 20_000 }, // $10k = smallest project we take; $25–30k mainline
    HOURLY: { floor: 50, target: 75, premium: 125 }, // a $25–30k, ~3-week sprint ≈ $100+/hr
    WEEKLY: { floor: 1_000, target: 2_000, premium: 5_000 },
    MONTHLY: { floor: 3_000, target: 4_000, premium: 8_000 }, // retainers from $4k/mo
  } satisfies Partial<Record<BudgetType, { floor: number; target: number; premium: number }>>,

  /** Smallest project worth taking, in USD. The LLM classifier caps anything it sizes below this at "maybe" (see icp-brief.md). */
  minProjectUsd: 10_000,

  /** Raised-amount bands in USD millions (doc §2 "Raised"). */
  raised: { excludeBelow: 2, bullseyeMin: 5, bullseyeMax: 60, acceptableMax: 150 },

  /** Minimum regex score for "qualified"; below `maybeMin` the job is rejected as a weak fit. */
  qualifiedMinScore: 4,
  maybeMinScore: 0,

  /** Client countries that count as premium markets (+1) or low-budget markets (−2). Matched case-insensitively. */
  premiumCountries: [
    "US", "USA", "United States", "UK", "GB", "United Kingdom", "Canada", "CA", "Australia", "AU",
    "Singapore", "SG", "Germany", "DE", "France", "FR", "Netherlands", "NL", "Sweden", "SE",
    "Switzerland", "CH", "Ireland", "IE", "Denmark", "DK", "Norway", "NO", "Finland", "FI",
    "Spain", "ES", "Italy", "IT", "Belgium", "BE", "Austria", "AT", "Israel", "IL", "New Zealand", "NZ",
  ],
  lowBudgetCountries: ["IN", "India"],
};
