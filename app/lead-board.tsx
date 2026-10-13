"use client";

import { useState, useTransition } from "react";
import { STAGES, type Stage } from "@/lib/pipeline.ts";
import type { CompanyLinks, IcpDecision, Lane } from "@/scraper/types.ts";
import { moveLead } from "./actions.ts";

export interface LeadRow {
  id: string;
  title: string;
  url: string;
  company: string | null;
  budget: string | null;
  valueUsd: number | null;
  rateUsd: number | null;
  lane: Lane;
  decision: IcpDecision;
  scope: string | null;
  basis: string | null;
  growth: string | null;
  concerns: string[];
  reasons: string[];
  companyLinks: CompanyLinks | null;
  postedAt: string | null;
  firstSeenAt: string;
  onBoard: boolean;
  stage: Stage;
}

const OPEN: Stage[] = ["new", "applied", "talking"];
type Filter = "open" | "all" | Stage;

const STAGE_STYLE: Record<Stage, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  applied: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  talking: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100",
  won: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  lost: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  passed: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function LeadBoard({ leads: initial }: { leads: LeadRow[] }) {
  const [leads, setLeads] = useState(initial);
  const [filter, setFilter] = useState<Filter>("open");
  const [lane, setLane] = useState<Lane | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function move(lead: LeadRow, stage: Stage) {
    const before = lead.stage;
    setError(null);
    setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, stage } : l)));
    startTransition(async () => {
      try {
        await moveLead(lead.id, lead.title, stage);
      } catch (e) {
        setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, stage: before } : l)));
        setError(`Couldn't save "${lead.title}": ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  const inLane = leads.filter((l) => lane === "all" || l.lane === lane);
  const count = (f: Filter) => inLane.filter((l) => matches(l, f)).length;
  const shown = inLane.filter((l) => matches(l, filter));
  const open = inLane.filter((l) => OPEN.includes(l.stage));
  const openValue = open.reduce((sum, l) => sum + (l.lane === "project" ? (l.valueUsd ?? 0) : 0), 0);
  const wonValue = inLane.filter((l) => l.stage === "won").reduce((sum, l) => sum + (l.valueUsd ?? 0), 0);

  return (
    <>
      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open leads" value={String(open.length)} />
        <Stat label="Open project value" value={usd(openValue)} />
        <Stat label="Still new" value={String(count("new"))} />
        <Stat label="Won" value={`${count("won")}${wonValue ? ` · ${usd(wonValue)}` : ""}`} />
      </dl>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="tablist">
          {(["open", ...STAGES.map((s) => s.id), "all"] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-sm ${
                filter === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {filterLabel(f)} <span className="opacity-60">{count(f)}</span>
            </button>
          ))}
        </div>
        <select
          value={lane}
          onChange={(e) => setLane(e.target.value as Lane | "all")}
          aria-label="Lane"
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
        >
          <option value="all">All lanes</option>
          <option value="project">Projects (apply on Contra)</option>
          <option value="outreach">Full-time (reach out)</option>
        </select>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">No leads here.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onMove={(s) => move(lead, s)} />
          ))}
        </ul>
      )}
    </>
  );
}

function matches(l: LeadRow, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "open") return OPEN.includes(l.stage);
  return l.stage === f;
}

function filterLabel(f: Filter): string {
  if (f === "open") return "Open";
  if (f === "all") return "All";
  return STAGES.find((s) => s.id === f)!.label;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function LeadCard({ lead, onMove }: { lead: LeadRow; onMove: (s: Stage) => void }) {
  const fullTime = lead.lane === "outreach";
  const meta = [
    lead.company,
    lead.budget,
    lead.postedAt && `posted ${day(lead.postedAt)}`,
  ].filter(Boolean);
  const links = lead.companyLinks
    ? ([["Website", lead.companyLinks.website], ["LinkedIn", lead.companyLinks.linkedin], ["X", lead.companyLinks.x]] as const).filter(
        ([, href]) => href,
      )
    : [];

  return (
    <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <a href={lead.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
              {lead.title}
            </a>
            {fullTime && (
              <span
                className="rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-800 dark:bg-violet-900 dark:text-violet-100"
                title="Full-time role: don't apply on Contra; reach out to the company and pitch a project"
              >
                full-time
              </span>
            )}
            {lead.decision === "maybe" && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-100">maybe</span>
            )}
            {!lead.onBoard && (
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title="Not in the latest scrape">
                off the board
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{meta.join(" · ")}</p>
          {(lead.valueUsd != null || lead.scope) && (
            <p className="mt-2 text-sm">
              {lead.valueUsd != null && (
                <span className="font-medium">
                  ~{usd(lead.valueUsd)}
                  {lead.rateUsd != null && ` · ${usd(lead.rateUsd)}/hr`}
                </span>
              )}
              {lead.valueUsd != null && lead.scope && " — "}
              {lead.scope}
            </p>
          )}
          {links.length > 0 && (
            <p className="mt-2 flex gap-3 text-xs">
              {links.map(([label, href]) => (
                <a key={label} href={href!} target="_blank" rel="noreferrer" className="underline hover:no-underline">
                  {label}
                </a>
              ))}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <select
            value={lead.stage}
            onChange={(e) => onMove(e.target.value as Stage)}
            aria-label={`Stage for ${lead.title}`}
            className={`rounded-md px-2 py-1.5 text-sm font-medium ${STAGE_STYLE[lead.stage]}`}
          >
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <a
            href={lead.url}
            target="_blank"
            rel="noreferrer"
            className={
              fullTime
                ? "rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                : "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            }
          >
            {fullTime ? "View post ↗" : "Apply on Contra ↗"}
          </a>
        </div>
      </div>

      {(lead.basis || lead.growth || lead.reasons.length > 0 || lead.concerns.length > 0) && (
        <details className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          <summary className="cursor-pointer select-none text-zinc-500">
            Why it qualified · first seen {day(lead.firstSeenAt)}
            {lead.concerns.length > 0 && <span className="ml-2 text-amber-700 dark:text-amber-400">⚠ {lead.concerns.join(", ")}</span>}
          </summary>
          <div className="mt-2 flex flex-col gap-1">
            {lead.basis && <p>{lead.basis}</p>}
            {lead.growth && <p>Could grow ({lead.growth})</p>}
            {lead.reasons.length > 0 && (
              <ul className="list-disc pl-5">
                {lead.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </li>
  );
}
