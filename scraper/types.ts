export type BudgetType = "FIXED" | "HOURLY" | "WEEKLY" | "MONTHLY" | "UNKNOWN";

export interface Job {
  id: string;
  title: string;
  slug: string;
  url: string;
  createdAt: string | null;
  approvedAt: string | null;
  category: string | null;
  /** The hiring company; null for private individuals. No poster names are stored (Contra terms). */
  organization: { name: string | null; isVerified: boolean } | null;
  /** Client's country as reported by Contra (often null). */
  country: string | null;
  /** True when the poster is hiring as a private individual rather than a company. */
  hiringAsIndividual: boolean;
  /** Plain-text job description (from get_job_by_slug, contact details removed); null when not fetched. Used for classifying only, never saved in run output. */
  description: string | null;
  budget: {
    type: BudgetType;
    /** Whole USD (or USD per hour/week/month for rate budgets). */
    feeMin: number | null;
    feeMax: number | null;
    estimatedHours: number | null;
  } | null;
  duration: { amount: number | null; interval: string | null } | null;
  roles: string[];
  tools: string[];
  timezone: { primaryUtcOffset: number | null; offsetTolerance: number | null };
  visitor: {
    applied: boolean;
    bookmarked: boolean;
    dismissed: boolean;
    viewed: boolean;
    matched: boolean;
  };
}

/** qualified = act on it; maybe = worth a human look; rejected = outside the ICP. */
export type IcpDecision = "qualified" | "maybe" | "rejected";
/** Positioning doc rings: carol = bullseye (isolate), diana = whey (10x), eddie = general protein (100x). */
export type IcpTier = "carol" | "diana" | "eddie";
/** How likely a job is to grow into a sprint or retainer (icp-brief.md, "Entry projects"). */
export type GrowthPotential = "high" | "medium" | "low" | "none";

/**
 * What we do with a job that fits:
 *   sprint   apply on Contra: a $10k+ sprint
 *   entry    apply on Contra: small now, from a client that could grow into a sprint (land and expand)
 *   outreach full-time role: don't apply; reach out to the company off Contra and pitch a sprint
 */
export type Lane = "sprint" | "entry" | "outreach";

/** Public links for the company behind an outreach job. People found by the lookup go only to the lead sheet. */
export interface CompanyLinks {
  website: string | null;
  linkedin: string | null;
  x: string | null;
}

export interface IcpVerdict {
  decision: IcpDecision;
  tier: IcpTier | null;
  /** Regex: summed signal weights. LLM: confidence × 10. Only comparable within one classifier. */
  score: number;
  /** Human-readable why, most important first. */
  reasons: string[];
  /** Machine-readable rule ids that fired, e.g. "reject:crypto", "+ai-native". */
  signals: string[];
  classifier: string;
  /** LLM classifiers only: how big the work is. */
  project?: {
    sprintTypes: ("brand" | "website" | "product-design-dev")[];
    /** The deliverables the post actually asks for. */
    scope: string;
    /** Estimated total project value in USD. */
    estimatedValueUsd: number | null;
    /** How the estimate was reached. */
    basis: string;
    /** Full-time / in-house role: we don't apply on Contra, we reach out on a different platform. */
    fullTime: boolean;
    /** How likely the work grows into a sprint or retainer. */
    growthPotential: GrowthPotential;
    /** The likely path, e.g. "logo → brand sprint → marketing site"; empty when there is none. */
    growthPath: string;
  };
}

export type ClassifiedJob = Job & {
  isNew: boolean;
  icp: IcpVerdict;
  /** null for rejected jobs. */
  lane: Lane | null;
  /** Posted to Slack by this run: the job fits and hasn't been posted before. */
  announce: boolean;
  /** Outreach jobs, when the lead lookup ran. */
  companyLinks?: CompanyLinks;
};

export interface RunResult {
  ranAt: string;
  preset: string;
  classifier: string;
  totalScraped: number;
  totalMatched: number;
  newSinceLastRun: number;
  counts: Record<IcpDecision, number>;
  /** True when the account (no Contra Pro) only sees a subset of the board. */
  accessLimited?: boolean;
  /** Total jobs on the board as reported by the MCP, if known. */
  boardTotal?: number | null;
  jobs: ClassifiedJob[];
  /** Jobs the ICP filter dropped, kept for auditing the rules. */
  rejected: { title: string; url: string; reasons: string[] }[];
}
