"use client";

import { useMemo, useState, type ReactNode } from "react";
import { STAGES } from "@/lib/pipeline.ts";
import type { BudgetType, IcpDecision } from "@/scraper/types.ts";

// Contra's job feed, rebuilt from the latest scrape: filters on the left, search and sort on top, one card per job
// with the client, budget, duration and skills, plus the AI layer's verdict. Same pieces as the lead board
// (PIXELUP Search Dashboard conventions: panels, white-pill segmented controls, brand-blue for the one action).

export interface BoardRow {
  id: string;
  title: string;
  url: string;
  /** null for a private individual (their name is never stored). */
  company: string | null;
  verified: boolean;
  postedAt: string | null;
  budget: string | null;
  budgetType: BudgetType;
  budgetTop: number | null;
  duration: string | null;
  timezone: string | null;
  country: string | null;
  skills: string[];
  /** null when the AI layer didn't read it (already applied to or dismissed on Contra). */
  decision: IcpDecision | null;
  fullTime: boolean;
  valueUsd: number | null;
  scope: string | null;
  reasons: string[];
  concerns: string[];
  applied: boolean;
  bookmarked: boolean;
  matched: boolean;
  /** The lead's stage on the dashboard, if it has one. */
  stage: string | null;
}

type Verdict = "all" | IcpDecision | "unjudged";
type Posted = "any" | "1" | "3" | "7" | "30";
type Kind = "all" | "fixed" | "hourly" | "fulltime";
type Sort = "newest" | "budget";

const PAGE = 40;
const DAY = 86_400_000;

const VERDICTS: { value: Verdict; label: string }[] = [
  { value: "all", label: "All jobs" },
  { value: "qualified", label: "Qualified" },
  { value: "maybe", label: "Maybe" },
  { value: "rejected", label: "Rejected" },
  { value: "unjudged", label: "Not judged" },
];
const POSTED: { value: Posted; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "1", label: "Last 24 hours" },
  { value: "3", label: "Last 3 days" },
  { value: "7", label: "Last week" },
  { value: "30", label: "Last month" },
];
const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "Any budget" },
  { value: "fixed", label: "Fixed price" },
  { value: "hourly", label: "Hourly" },
  { value: "fulltime", label: "Full-time roles" },
];

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";
const btnBase = `pressable inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap select-none ${focusRing}`;
const btnSimple = `${btnBase} border-[0.5px] border-foreground/5 bg-card text-foreground shadow-btn-simple hover:border-foreground/10 hover:shadow-btn-simple-hover`;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function ago(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const ms = now - new Date(iso).getTime();
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m ago`;
  if (ms < DAY) return `${Math.round(ms / 3_600_000)}h ago`;
  if (ms < 30 * DAY) return `${Math.round(ms / DAY)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function matchesVerdict(j: BoardRow, v: Verdict) {
  return v === "all" || (v === "unjudged" ? j.decision === null : j.decision === v);
}
function matchesKind(j: BoardRow, k: Kind) {
  if (k === "all") return true;
  if (k === "fulltime") return j.fullTime;
  return k === "fixed" ? j.budgetType === "FIXED" : j.budgetType === "HOURLY";
}
function matchesPosted(j: BoardRow, p: Posted, now: number) {
  return p === "any" || (!!j.postedAt && now - new Date(j.postedAt).getTime() <= Number(p) * DAY);
}

export function JobBoard({ jobs, now }: { jobs: BoardRow[]; now: number }) {
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState<Verdict>("all");
  const [posted, setPosted] = useState<Posted>("any");
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [limit, setLimit] = useState(PAGE);

  const searched = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return jobs;
    return jobs.filter((j) => {
      const text = [j.title, j.company, j.scope, ...j.skills, ...j.reasons].filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [jobs, query]);

  // Each group's counts honour the other two groups' choices, as a faceted filter does.
  const inVerdict = searched.filter((j) => matchesVerdict(j, verdict));
  const inPosted = searched.filter((j) => matchesPosted(j, posted, now));
  const shown = searched
    .filter((j) => matchesVerdict(j, verdict) && matchesPosted(j, posted, now) && matchesKind(j, kind))
    .sort((a, b) =>
      sort === "budget"
        ? (b.valueUsd ?? b.budgetTop ?? 0) - (a.valueUsd ?? a.budgetTop ?? 0)
        : (b.postedAt ?? "").localeCompare(a.postedAt ?? ""),
    );

  function reset(fn: () => void) {
    fn();
    setLimit(PAGE);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
      <aside className="panel space-y-4 p-3 lg:sticky lg:top-6">
        <FilterGroup
          label="AI layer"
          value={verdict}
          onChange={(v) => reset(() => setVerdict(v))}
          options={VERDICTS.map((o) => ({ ...o, count: inPosted.filter((j) => matchesKind(j, kind) && matchesVerdict(j, o.value)).length }))}
        />
        <FilterGroup
          label="Posted"
          value={posted}
          onChange={(v) => reset(() => setPosted(v))}
          options={POSTED.map((o) => ({ ...o, count: inVerdict.filter((j) => matchesKind(j, kind) && matchesPosted(j, o.value, now)).length }))}
        />
        <FilterGroup
          label="Type"
          value={kind}
          onChange={(v) => reset(() => setKind(v))}
          options={KINDS.map((o) => ({ ...o, count: inVerdict.filter((j) => matchesPosted(j, posted, now) && matchesKind(j, o.value)).length }))}
        />
      </aside>

      <section className="min-w-0 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Search jobs</span>
            <svg className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => reset(() => setQuery(e.target.value))}
              placeholder="Search titles, companies, skills…"
              className={`h-10 w-full rounded-xl border-[0.5px] border-foreground/10 bg-card pr-3 pl-9 text-sm shadow-card placeholder:text-muted-foreground ${focusRing}`}
            />
          </label>
          <Segmented
            aria-label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: "newest", label: "Newest" },
              { value: "budget", label: "Highest budget" },
            ]}
          />
        </div>

        <p className="px-1 text-xs text-muted-foreground">
          {shown.length === jobs.length ? `${jobs.length} jobs` : `${shown.length} of ${jobs.length} jobs`}
        </p>

        {shown.length === 0 ? (
          <div className="panel px-4 py-16 text-center text-muted-foreground">No jobs match these filters.</div>
        ) : (
          <ul className="space-y-3">
            {shown.slice(0, limit).map((j) => (
              <JobCard key={j.id} job={j} now={now} />
            ))}
          </ul>
        )}

        {shown.length > limit && (
          <div className="flex justify-center pt-2">
            <button type="button" onClick={() => setLimit((n) => n + PAGE)} className={btnSimple}>
              Show {Math.min(PAGE, shown.length - limit)} more
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count: number }[];
}) {
  return (
    <div role="radiogroup" aria-label={label}>
      <div className="px-2 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] lg:flex-col">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={`pressable flex h-8 shrink-0 items-center justify-between gap-3 rounded-lg px-2.5 text-left text-sm whitespace-nowrap ${focusRing} ${
                on ? "bg-muted font-medium text-foreground shadow-track" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {o.label}
              <span className="tnum text-xs text-muted-foreground">{o.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The search dashboard's segmented control: a warm track, the selected option on a white pill. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
  "aria-label": label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  "aria-label": string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 items-center gap-0.5 self-start rounded-[14px] bg-muted/70 p-1 shadow-track sm:self-auto">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`pressable inline-flex h-7 items-center rounded-[10px] px-2.5 text-xs font-medium whitespace-nowrap ${focusRing} ${
              on ? "bg-card text-foreground shadow-tab" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Pill({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "brand" | "good" | "warn" | "quiet"; title?: string }) {
  const tones = {
    neutral: "bg-foreground/[0.04] text-foreground/75 ring-foreground/10",
    quiet: "bg-transparent text-muted-foreground ring-foreground/10",
    brand: "bg-brand/5 text-brand ring-brand/20",
    good: "bg-emerald-500/10 text-emerald-800 ring-emerald-600/20",
    warn: "bg-amber-500/10 text-amber-800 ring-amber-600/20",
  };
  return (
    <span title={title} className={`inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-[11.5px] font-medium whitespace-nowrap ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

const VERDICT_PILL: Record<IcpDecision, { label: string; tone: "good" | "warn" | "quiet" }> = {
  qualified: { label: "Qualified", tone: "good" },
  maybe: { label: "Maybe", tone: "warn" },
  rejected: { label: "Rejected", tone: "quiet" },
};

/** A soft, stable tint per client, like Contra's logo tiles. */
function Avatar({ name }: { name: string | null }) {
  const label = name ?? "Private client";
  let hash = 0;
  for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  const initials = name
    ? name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")
    : null;
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-foreground/80"
      style={{ background: `oklch(0.94 0.035 ${hash})` }}
    >
      {initials || (
        <svg className="size-4.5" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="5.5" r="2.75" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2.75 13.5c.6-2.5 2.7-3.75 5.25-3.75s4.65 1.25 5.25 3.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

function JobCard({ job, now }: { job: BoardRow; now: number }) {
  const posted = ago(job.postedAt, now);
  const verdict = job.decision ? VERDICT_PILL[job.decision] : null;
  const stage = job.stage ? STAGES.find((s) => s.id === job.stage)?.label : null;
  const note = job.decision === "rejected" || !job.scope ? job.reasons[0] : job.scope;
  const facts = [job.duration, job.timezone, job.country].filter(Boolean);
  const more = job.reasons.length > 1 || (job.scope && job.reasons.length > 0);

  return (
    <li className="panel p-4 sm:p-5">
      <div className="flex items-start gap-3.5">
        <Avatar name={job.company} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted-foreground">
            <span className="font-medium text-foreground/85">{job.company ?? "Private client"}</span>
            {job.verified && (
              <svg className="size-3.5 text-brand" viewBox="0 0 16 16" aria-label="Verified">
                <path fill="currentColor" d="M8 1l1.8 1.3 2.2-.1.7 2.1 1.8 1.3-.7 2.1.7 2.1-1.8 1.3-.7 2.1-2.2-.1L8 15l-1.8-1.3-2.2.1-.7-2.1L1.5 10.4l.7-2.1-.7-2.1 1.8-1.3.7-2.1 2.2.1z" />
                <path d="M5.5 8.2l1.7 1.7 3.3-3.6" stroke="white" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {posted && <span>· {posted}</span>}
          </div>
          <a href={job.url} target="_blank" rel="noreferrer" className={`mt-0.5 block rounded-sm text-base leading-snug font-semibold text-pretty hover:text-brand ${focusRing}`}>
            {job.title}
          </a>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            {job.budget && <span className="tnum font-semibold">{job.budget}</span>}
            {job.valueUsd != null && <span className="tnum text-muted-foreground">~{usd(job.valueUsd)} est.</span>}
            {facts.map((f) => (
              <span key={f} className="text-muted-foreground">
                {f}
              </span>
            ))}
          </div>

          {job.skills.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {job.skills.slice(0, 6).map((s) => (
                <span key={s} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground/75">
                  {s}
                </span>
              ))}
              {job.skills.length > 6 && <span className="px-1 py-0.5 text-xs text-muted-foreground">+{job.skills.length - 6}</span>}
            </div>
          )}

          {note && <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground text-pretty">{note}</p>}

          {more && (
            <details className="group mt-1.5">
              <summary className="w-fit cursor-pointer list-none text-xs font-medium tracking-wide text-muted-foreground uppercase select-none hover:text-foreground">
                <span className="group-open:hidden">Why</span>
                <span className="hidden group-open:inline">Hide</span>
              </summary>
              <div className="mt-2 space-y-1.5 rounded-xl bg-muted/70 px-3.5 py-3 text-[13px] leading-relaxed text-muted-foreground">
                {job.reasons.map((r) => (
                  <p key={r}>{r}</p>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="hidden shrink-0 flex-col items-end gap-2 sm:flex">
          <CardBadges job={job} verdict={verdict} stage={stage} />
          <a href={job.url} target="_blank" rel="noreferrer" className={`${btnSimple} mt-1`}>
            View on Contra
            <svg className="size-3.5 opacity-70" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M5.5 10.5l5-5M6 5.5h4.5V10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 sm:hidden">
        <CardBadges job={job} verdict={verdict} stage={stage} />
      </div>
    </li>
  );
}

function CardBadges({ job, verdict, stage }: { job: BoardRow; verdict: (typeof VERDICT_PILL)[IcpDecision] | null; stage: string | null | undefined }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {job.applied && <Pill tone="brand">Applied</Pill>}
      {stage && !job.applied && <Pill title="Stage on the Leads page">{stage}</Pill>}
      {job.fullTime && <Pill title="Full-time role: reach out off Contra and pitch a project">Full-time</Pill>}
      {job.matched && <Pill title="Contra matched this job to the account">Matched</Pill>}
      {job.bookmarked && <Pill>Saved</Pill>}
      {verdict ? (
        <Pill tone={verdict.tone} title="The AI layer's verdict">
          {verdict.label}
        </Pill>
      ) : (
        <Pill tone="quiet" title="Skipped before the AI layer: already applied to or dismissed on Contra">
          Not judged
        </Pill>
      )}
    </div>
  );
}
