import { isOutreachLead } from "./lanes.ts";
import type { Lead } from "./leads.ts";
import type { ClassifiedJob, Lane, RunResult } from "./types.ts";

// Formats a run's announced jobs: the Slack message (notify.ts) and the lead sheet rows (sheet.ts).
// Pure functions, so tests can check them without posting anything.

const MAX_PER_LANE = 10; // keep the message readable; the rest are summarized

const SECTIONS: { lane: Lane; title: string; noun: string }[] = [
  { lane: "project", title: "🎯 Apply on Contra: projects ($50/hr+, over $3,500)", noun: "project" },
  { lane: "entry", title: "🌱 Apply on Contra: entry projects (small now, could grow)", noun: "entry project" },
  { lane: "outreach", title: "📇 Full-time roles: don't apply, reach out off Contra and pitch a project", noun: "full-time lead" },
];

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function budget(b: ClassifiedJob["budget"]): string {
  if (!b || (b.feeMin == null && b.feeMax == null)) return "budget n/a";
  const range = b.feeMin != null && b.feeMax != null && b.feeMin !== b.feeMax
    ? `${money(b.feeMin)}–${money(b.feeMax)}`
    : money((b.feeMax ?? b.feeMin) as number);
  return range + { FIXED: " fixed", HOURLY: "/hr", WEEKLY: "/wk", MONTHLY: "/mo", UNKNOWN: "" }[b.type];
}

/** Claude's sizing, e.g. "~$4,800 ($60/hr × ~80 hrs) · website: 10-page marketing site". */
function size(j: ClassifiedJob): string | null {
  const p = j.icp.project;
  if (!p) return null;
  const { hourlyRateUsd: rate, estimatedHours: hours, estimatedValueUsd: total } = p;
  // Shown only when it adds up, so a mismatched estimate never reads as arithmetic.
  const adds = rate != null && hours != null && total != null && Math.abs(rate * hours - total) <= 0.1 * total;
  const working = adds ? ` (${money(rate)}/hr × ~${hours.toLocaleString("en-US")} hrs)` : "";
  const value = total != null ? `~${money(total)}${working}` : "size unclear";
  const kind = p.sprintTypes.join(" + ");
  return `${value}${kind ? ` · ${kind}` : ""}${p.scope ? `: ${p.scope}` : ""}`;
}

function companyLinks(j: ClassifiedJob): string {
  const l = j.companyLinks;
  const found = l ? ([["Site", l.website], ["LinkedIn", l.linkedin], ["X", l.x]] as const).filter(([, u]) => u) : [];
  return found.length ? found.map(([k, u]) => `${k}: ${u}`).join(" · ") : "Company links not found; look them up by hand";
}

/** Title, client, budget and estimated size, plus the link — the reasons stay in the app. */
function line(j: ClassifiedJob): string {
  const rows = [`• ${j.title}`, `  ${[j.organization?.name, budget(j.budget)].filter(Boolean).join(" · ")}`];
  const est = size(j);
  if (est) rows.push(`  ${est}`);
  if (j.lane === "entry" && j.icp.project?.growthPath) rows.push(`  Could grow: ${j.icp.project.growthPath}`);
  const concerns = j.icp.project?.concerns ?? [];
  if (concerns.length) rows.push(`  ⚠ ${concerns.join(" · ")}`);
  if (j.lane === "outreach") rows.push(`  ${companyLinks(j)}`);
  rows.push(`  ${j.url}`);
  return rows.join("\n");
}

/** The Workflow Builder webhook's two Text variables. */
export function slackMessage(run: RunResult, sheetUrl?: string): { summary: string; jobs: string } {
  const fresh = run.jobs.filter((j) => j.announce);
  const when = new Date(run.ranAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  });
  const sections = SECTIONS.map((s) => ({ ...s, jobs: fresh.filter((j) => j.lane === s.lane) })).filter((s) => s.jobs.length);
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

  const summary = fresh.length
    ? `${plural(fresh.length, "Contra job")} to act on (${sections.map((s) => plural(s.jobs.length, s.noun)).join(", ")}) · ${when} IST`
    : `No new Contra jobs to act on · ${when} IST`;
  const jobs = sections.length
    ? sections
        .map((s) =>
          [
            s.title,
            ...s.jobs.slice(0, MAX_PER_LANE).map(line),
            ...(s.jobs.length > MAX_PER_LANE ? [`…and ${s.jobs.length - MAX_PER_LANE} more`] : []),
            ...(s.lane === "outreach" && sheetUrl ? [`Founders and lookup notes are in the lead sheet: ${sheetUrl}`] : []),
          ].join("\n"),
        )
        .join("\n\n")
    : "—";
  return { summary, jobs };
}

export const SHEET_HEADERS = [
  "Found", "Company", "Role", "Contra job", "Fit", "Est. value", "Website", "Company LinkedIn", "Company X",
  "People", "Lookup confidence", "Lookup notes", "Status",
];
/** The column the Apps Script dedupes on. */
export const SHEET_KEY = "Contra job";

/** Sheets runs text starting with = + - @ as a formula; a leading apostrophe keeps it plain text. */
const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
};

/**
 * One row per current full-time lead (see isOutreachLead), in SHEET_HEADERS order; the sheet skips jobs it
 * already has. `leads` holds the lookups by job id.
 */
export function sheetRows(run: RunResult, leads: Map<string, Lead>): string[][] {
  const found = new Date(run.ranAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
  return run.jobs
    .filter(isOutreachLead)
    .map((j) => {
      const lead = leads.get(j.id);
      const people = (lead?.people ?? [])
        .map((p) => [`${p.name}${p.role ? ` (${p.role})` : ""}`, p.linkedin, p.x].filter(Boolean).join(" · "))
        .join("\n");
      const value = j.icp.project?.estimatedValueUsd;
      return [
        found,
        j.organization?.name ?? "",
        j.title,
        j.url,
        [j.icp.decision, j.icp.tier].filter(Boolean).join(" · "),
        value != null ? money(value) : "",
        lead?.website ?? "",
        lead?.linkedin ?? "",
        lead?.x ?? "",
        people,
        lead ? (lead.found ? lead.confidence : "not found") : "not looked up",
        lead?.notes ?? "",
        "",
      ].map(cell);
    });
}
