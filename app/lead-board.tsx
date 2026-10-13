"use client";

import { useEffect, useRef, useState, useTransition, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { STAGES, type Stage } from "@/lib/pipeline.ts";
import type { CompanyLinks, IcpDecision, Lane } from "@/scraper/types.ts";
import { moveLead } from "./actions.ts";

// Built from the PIXELUP Search Dashboard's pieces (its docs/ui-conventions.md): panel cards, the KPI strip,
// segmented tabs with a white pill, dropdowns that fill with ink on hover (never a native select), brand-blue
// primary buttons.

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
  /** Our answer to Contra's "why you'd be a good fit" field, written during the scrape; null until then. */
  brief: string | null;
}

const OPEN: Stage[] = ["new", "applied", "talking"];
type Filter = "open" | "all" | Stage;

const STAGE_DOT: Record<Stage, string> = {
  new: "bg-brand",
  applied: "bg-amber-500",
  talking: "bg-violet-500",
  won: "bg-emerald-500",
  lost: "bg-zinc-400",
  passed: "bg-zinc-300",
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";
const btnBase = `pressable inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap select-none ${focusRing}`;
const btnPrimary = `${btnBase} bg-brand text-white shadow-btn-primary hover:bg-[color-mix(in_oklch,var(--brand),black_8%)] hover:shadow-btn-primary-hover`;
const btnSimple = `${btnBase} border-[0.5px] border-foreground/5 bg-card text-foreground shadow-btn-simple hover:border-foreground/10 hover:shadow-btn-simple-hover`;

export function LeadBoard({ leads: initial }: { leads: LeadRow[] }) {
  const [leads, setLeads] = useState(initial);
  const [filter, setFilter] = useState<Filter>("open");
  const [lane, setLane] = useState<Lane | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastCount = useRef(0);
  const [, startTransition] = useTransition();

  function notify(text: string) {
    clearTimeout(toastTimer.current);
    setToast({ text, key: ++toastCount.current });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  function copyBrief(lead: LeadRow) {
    if (!lead.brief) return notify("No application brief for this job yet: it's written on the next scrape");
    const brief = lead.brief;
    // Started inside the click, while the page still has the user's gesture and focus.
    (navigator.clipboard?.writeText(brief) ?? Promise.reject(new Error("no clipboard API")))
      .catch(() => {
        if (!copyWithSelection(brief)) throw new Error("copy failed");
      })
      .then(
        () => notify("Application brief copied to clipboard"),
        () => notify("Couldn't copy the brief: open Details and copy it from there"),
      );
  }

  /** Apply: copy the brief, show that it's copied, then open the post on Contra to paste it in. */
  function apply(lead: LeadRow, e: ReactMouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    copyBrief(lead);
    setTimeout(() => {
      const tab = window.open(lead.url, "_blank");
      if (tab) tab.opener = null;
      else notify("Your browser blocked the new tab: open the post from its title");
    }, 700);
  }

  function move(lead: LeadRow, stage: Stage) {
    if (stage === lead.stage) return;
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
    <div className="space-y-4">
      <div className="panel grid grid-cols-2 gap-x-4 gap-y-5 p-4 sm:flex sm:gap-0 sm:px-5 sm:pt-4 sm:pb-3 sm:[&>*]:flex-1 sm:[&>*:not(:last-child)]:mr-5 sm:[&>*:not(:last-child)]:border-r sm:[&>*:not(:last-child)]:pr-5">
        <Kpi label="Open leads" value={String(open.length)} />
        <Kpi label="Open project value" value={usd(openValue)} />
        <Kpi label="Not yet acted on" value={String(count("new"))} />
        <Kpi label="Won" value={wonValue ? usd(wonValue) : String(count("won"))} />
      </div>

      <div className="panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-2">
          <Segmented
            aria-label="Stage"
            value={filter}
            onChange={setFilter}
            options={(["open", ...STAGES.map((s) => s.id), "all"] as Filter[]).map((f) => ({ value: f, label: filterLabel(f), count: count(f) }))}
          />
          <Segmented
            aria-label="Lane"
            value={lane}
            onChange={setLane}
            options={[
              { value: "all", label: "All" },
              { value: "project", label: "Projects" },
              { value: "outreach", label: "Full-time" },
            ]}
          />
        </div>

        {error && (
          <p role="alert" className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {shown.length === 0 ? (
          <p className="px-4 py-16 text-center text-muted-foreground">No leads in this stage.</p>
        ) : (
          <ul className="divide-y">
            {shown.map((lead) => (
              <LeadItem key={lead.id} lead={lead} onMove={(s) => move(lead, s)} onApply={(e) => apply(lead, e)} onCopy={() => copyBrief(lead)} />
            ))}
          </ul>
        )}
      </div>

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {toast && (
          <div key={toast.key} className="toast-in flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-menu">
            <svg className="size-4 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {toast.text}
          </div>
        )}
      </div>
    </div>
  );
}

/** The older copy route, for browsers or embedded views that refuse the Clipboard API. */
function copyWithSelection(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
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

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-xs text-muted-foreground md:text-sm">{label}</div>
      <div className="tnum truncate text-xl leading-7 font-bold md:text-[1.65rem] md:leading-9">{value}</div>
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
  options: { value: T; label: string; count?: number }[];
  "aria-label": string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[14px] bg-muted/70 p-1 shadow-track [scrollbar-width:none]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`pressable inline-flex h-7 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-[10px] px-2.5 text-xs leading-none font-medium whitespace-nowrap ${focusRing} ${
              on ? "bg-card text-foreground shadow-tab" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
            {o.count !== undefined && <span className="tnum text-[11px] font-normal text-muted-foreground">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Badge({ children, title, tone = "neutral" }: { children: ReactNode; title?: string; tone?: "neutral" | "brand" | "warn" }) {
  const tones = {
    neutral: "bg-foreground/[0.04] text-foreground/75 ring-foreground/10",
    brand: "bg-brand/5 text-brand ring-brand/20",
    warn: "bg-amber-500/10 text-amber-800 ring-amber-600/20",
  };
  return (
    <span title={title} className={`inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-[11.5px] font-medium whitespace-nowrap ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Stage picker: a simple button that opens a menu; the highlighted item fills with ink. */
function StageMenu({ lead, onMove }: { lead: LeadRow; onMove: (s: Stage) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const current = STAGES.find((s) => s.id === lead.stage)!;

  useEffect(() => {
    if (!open) return;
    items.current[STAGES.findIndex((s) => s.id === lead.stage)]?.focus();
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, lead.stage]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>("[aria-haspopup]")?.focus();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = items.current.indexOf(document.activeElement as HTMLButtonElement);
      const next = (i + (e.key === "ArrowDown" ? 1 : -1) + STAGES.length) % STAGES.length;
      items.current[next]?.focus();
    }
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Stage: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        className={`${btnSimple} w-30 justify-between pr-2 pl-2.5`}
      >
        <span className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${STAGE_DOT[lead.stage]}`} />
          {current.label}
        </span>
        <svg className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="menu-surface absolute right-0 z-50 mt-2 w-40 space-y-0.5 p-1">
          {STAGES.map((s, i) => (
            <button
              key={s.id}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={s.id === lead.stage}
              onClick={() => {
                onMove(s.id);
                setOpen(false);
              }}
              className="group pressable flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium outline-none hover:bg-ink hover:text-white focus-visible:bg-ink focus-visible:text-white"
            >
              <span className={`size-2 rounded-full ${STAGE_DOT[s.id]}`} />
              {s.label}
              {s.id === lead.stage && (
                <svg className="ml-auto size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadItem({
  lead,
  onMove,
  onApply,
  onCopy,
}: {
  lead: LeadRow;
  onMove: (s: Stage) => void;
  onApply: (e: ReactMouseEvent<HTMLAnchorElement>) => void;
  onCopy: () => void;
}) {
  const fullTime = lead.lane === "outreach";
  const meta = [lead.company, lead.budget, lead.postedAt && `posted ${day(lead.postedAt)}`].filter(Boolean);
  const links = lead.companyLinks
    ? ([["Website", lead.companyLinks.website], ["LinkedIn", lead.companyLinks.linkedin], ["X", lead.companyLinks.x]] as const).filter(
        ([, href]) => href,
      )
    : [];
  const hasDetails = lead.brief || lead.basis || lead.growth || lead.reasons.length > 0;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a href={lead.url} target="_blank" rel="noreferrer" className={`rounded-sm text-[15px] font-medium hover:text-brand ${focusRing}`}>
              {lead.title}
            </a>
            {fullTime && (
              <Badge tone="brand" title="Full-time role: don't apply on Contra; reach out to the company and pitch a project">
                Full-time
              </Badge>
            )}
            {lead.decision === "maybe" && <Badge>Maybe</Badge>}
            {!lead.onBoard && <Badge title="Not in the latest scrape">Off the board</Badge>}
          </div>
          <p className="mt-1 text-muted-foreground">{meta.join(" · ")}</p>
          {lead.scope && <p className="mt-2 line-clamp-2 text-pretty">{lead.scope}</p>}
          {(links.length > 0 || lead.concerns.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {lead.concerns.map((c) => (
                <Badge key={c} tone="warn">
                  {c}
                </Badge>
              ))}
              {links.map(([label, href]) => (
                <a key={label} href={href!} target="_blank" rel="noreferrer" className={`rounded-sm px-1 text-xs text-muted-foreground hover:text-brand ${focusRing}`}>
                  {label} ↗
                </a>
              ))}
            </div>
          )}
          {hasDetails && (
            <details className="group mt-2.5">
              <summary className="w-fit cursor-pointer list-none text-xs font-medium tracking-wide text-muted-foreground uppercase select-none hover:text-foreground">
                <span className="group-open:hidden">{lead.brief ? "Brief and details" : "Why it qualified"}</span>
                <span className="hidden group-open:inline">Hide</span>
              </summary>
              {lead.brief && (
                <div className="mt-2 rounded-xl border bg-card px-3.5 py-3">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Application brief <span className="tnum font-normal normal-case">· {lead.brief.length.toLocaleString("en-US")} / 1,500</span>
                    </span>
                    <button type="button" onClick={onCopy} className={`${btnSimple} h-7 px-2.5 text-xs`}>
                      Copy
                    </button>
                  </div>
                  <p className="text-[13px] leading-relaxed whitespace-pre-line">{lead.brief}</p>
                </div>
              )}
              <div className="mt-2 space-y-1.5 rounded-xl bg-muted/70 px-3.5 py-3 text-[13px] leading-relaxed text-muted-foreground">
                {lead.basis && <p>{lead.basis}</p>}
                {lead.growth && <p>Could grow ({lead.growth})</p>}
                {lead.reasons.map((r) => (
                  <p key={r}>{r}</p>
                ))}
                <p className="text-xs">First seen {day(lead.firstSeenAt)}</p>
              </div>
            </details>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-4 sm:flex-col sm:items-end sm:gap-3">
          {lead.valueUsd != null && (
            <div className="sm:text-right">
              <div className="tnum text-base font-bold">~{usd(lead.valueUsd)}</div>
              {lead.rateUsd != null && <div className="tnum text-xs text-muted-foreground">{usd(lead.rateUsd)}/hr</div>}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <StageMenu lead={lead} onMove={onMove} />
            <a
              href={lead.url}
              target="_blank"
              rel="noreferrer"
              onClick={fullTime ? undefined : onApply}
              title={fullTime ? undefined : "Copies the application brief, then opens the post on Contra"}
              className={fullTime ? btnSimple : btnPrimary}
            >
              {fullTime ? "View post" : "Apply"}
              <svg className="size-3.5 opacity-80" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M5.5 10.5l5-5M6 5.5h4.5V10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </li>
  );
}
