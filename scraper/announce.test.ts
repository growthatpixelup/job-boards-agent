import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHEET_HEADERS, sheetRows, slackMessage } from "./announce.ts";
import { LLM_FAILED } from "./icp/llm.ts";
import { isActionable, laneOf, toClassified } from "./lanes.ts";
import { cleanLead, type Lead } from "./leads.ts";
import type { ClassifiedJob, IcpVerdict, Job, RunResult } from "./types.ts";

// Lanes, the announce-once rule, and what reaches Slack and the lead sheet.

function verdict(p: Partial<IcpVerdict> & { value?: number | null; fullTime?: boolean; growthPath?: string } = {}): IcpVerdict {
  const { value = 25_000, fullTime = false, growthPath = "", ...rest } = p;
  return {
    decision: "qualified",
    tier: "diana",
    score: 8,
    reasons: [],
    signals: [],
    classifier: "test",
    project: {
      sprintTypes: ["brand"], scope: "rebrand", estimatedValueUsd: value, basis: "fixed", fullTime,
      growthPotential: growthPath ? "high" : "none", growthPath,
    },
    ...rest,
  };
}

function job(id: string, p: Partial<Job> = {}): Job {
  return {
    id,
    title: `Job ${id}`,
    slug: id,
    url: `https://contra.com/opportunity/${id}`,
    createdAt: null,
    approvedAt: null,
    category: null,
    organization: { name: `Company ${id}`, isVerified: false },
    country: null,
    hiringAsIndividual: false,
    description: null,
    budget: { type: "FIXED", feeMin: 2_000, feeMax: 3_000, estimatedHours: null },
    duration: null,
    roles: [],
    tools: [],
    timezone: { primaryUtcOffset: null, offsetTolerance: null },
    visitor: { applied: false, bookmarked: false, dismissed: false, viewed: false, matched: false },
    ...p,
  };
}

const none = new Set<string>();
const run = (jobs: ClassifiedJob[]): RunResult => ({
  ranAt: "2026-10-13T05:30:00.000Z", preset: "ALL", classifier: "test", totalScraped: jobs.length, totalMatched: jobs.length,
  newSinceLastRun: 0, counts: { qualified: jobs.length, maybe: 0, rejected: 0 }, jobs, rejected: [],
});

describe("lanes", () => {
  it("sorts fitting jobs into sprint, entry and outreach", () => {
    assert.equal(laneOf(verdict()), "sprint");
    assert.equal(laneOf(verdict({ value: 2_500 })), "entry");
    assert.equal(laneOf(verdict({ fullTime: true, value: 60_000 })), "outreach");
    assert.equal(laneOf(verdict({ decision: "rejected" })), null);
    assert.equal(laneOf({ ...verdict(), project: undefined, signals: ["flag:full-time"] }), "outreach"); // regex verdicts
  });

  it("acts on qualified sprints and entry projects, and on full-time roles even as a maybe", () => {
    assert.ok(isActionable({ icp: verdict(), lane: "sprint" }));
    assert.ok(!isActionable({ icp: verdict({ decision: "maybe" }), lane: "sprint" }));
    assert.ok(!isActionable({ icp: verdict({ decision: "maybe", value: 2_500 }), lane: "entry" }));
    assert.ok(isActionable({ icp: verdict({ decision: "maybe", fullTime: true }), lane: "outreach" }));
  });

  it("announces a job once, only after the LLM has read it", () => {
    const fits = verdict();
    assert.equal(toClassified(job("a"), fits, none, none).announce, true);
    assert.equal(toClassified(job("a"), fits, none, new Set(["a"])).announce, false);
    // An older job the new rubric qualifies is announced too (it's been seen, not announced).
    const older = toClassified(job("b"), fits, new Set(["b"]), none);
    assert.deepEqual([older.isNew, older.announce], [false, true]);
    assert.equal(toClassified(job("c"), { ...fits, signals: [LLM_FAILED] }, none, none).announce, false);
  });
});

describe("Slack message", () => {
  const sprint = toClassified(job("s", { title: "Rebrand for AI infra startup" }), verdict(), none, none);
  const entry = toClassified(job("e", { title: "Logo for funded devtool" }), verdict({ value: 2_500, growthPath: "logo → brand sprint → site" }), none, none);
  const outreach = {
    ...toClassified(job("o", { title: "Founding product designer" }), verdict({ fullTime: true, value: 60_000 }), none, none),
    companyLinks: { website: "https://acme.ai/", linkedin: "https://www.linkedin.com/company/acme-ai/", x: null },
  };
  const old = toClassified(job("x"), verdict(), none, new Set(["x"]));

  it("groups announced jobs by lane, with the growth path and company links", () => {
    const { summary, jobs } = slackMessage(run([outreach, old, entry, sprint]), "https://docs.google.com/spreadsheets/d/abc");
    assert.match(summary, /^3 Contra jobs to act on \(1 sprint, 1 entry project, 1 full-time lead\)/);
    const order = ["Apply on Contra: sprints", "entry projects", "Full-time roles"].map((t) => jobs.indexOf(t));
    assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), "sections in lane order");
    assert.match(jobs, /Could grow: logo → brand sprint → site/);
    assert.match(jobs, /Site: https:\/\/acme\.ai\/ · LinkedIn: https:\/\/www\.linkedin\.com\/company\/acme-ai\//);
    assert.match(jobs, /lead sheet: https:\/\/docs\.google\.com/);
    assert.ok(!jobs.includes("Job x"), "already-announced jobs aren't repeated");
  });

  it("says so when there is nothing to act on", () => {
    assert.deepEqual(slackMessage(run([old])).jobs, "—");
    assert.match(slackMessage(run([old])).summary, /^No new Contra jobs to act on/);
  });
});

describe("lead sheet", () => {
  const outreach = toClassified(job("o", { title: "=HYPERLINK(evil)" }), verdict({ fullTime: true, value: 60_000 }), none, none);
  const lead: Lead = {
    found: true, website: "https://acme.ai/", linkedin: "https://www.linkedin.com/company/acme-ai/", x: "https://x.com/acme",
    people: [{ name: "Jane Doe", role: "CEO", linkedin: "https://www.linkedin.com/in/janedoe/", x: null }],
    confidence: "high", notes: "Matched on the product described in the post",
  };

  it("writes one row per current full-time lead, in header order and formula-safe", () => {
    const sprint = toClassified(job("s"), verdict(), none, none);
    const fullTime = verdict({ fullTime: true, value: 60_000 });
    // Posted to Slack before the sheet was connected: still sent, and the sheet skips it if it's there.
    const earlier = toClassified(job("e"), fullTime, none, new Set(["e"]));
    const individual = toClassified(job("i", { organization: null, hiringAsIndividual: true }), fullTime, none, none);
    const unchecked = toClassified(job("u"), { ...fullTime, signals: [LLM_FAILED] }, none, none);
    const rows = sheetRows(run([outreach, sprint, earlier, individual, unchecked]), new Map([["o", lead]]));
    assert.deepEqual(rows.map((r) => r[SHEET_HEADERS.indexOf("Contra job")]), ["https://contra.com/opportunity/o", "https://contra.com/opportunity/e"]);
    const row = Object.fromEntries(SHEET_HEADERS.map((h, i) => [h, rows[0][i]]));
    assert.equal(row["Role"], "'=HYPERLINK(evil)");
    assert.equal(row["Contra job"], "https://contra.com/opportunity/o");
    assert.equal(row["People"], "Jane Doe (CEO) · https://www.linkedin.com/in/janedoe/");
    assert.equal(row["Est. value"], "$60,000");
    assert.equal(row["Lookup confidence"], "high");
  });

  it("still adds the role when the lookup didn't run", () => {
    assert.equal(sheetRows(run([outreach]), new Map())[0][SHEET_HEADERS.indexOf("Lookup confidence")], "not looked up");
  });

  it("keeps only real company and profile links from the lookup", () => {
    const l = cleanLead({
      found: true,
      website: "https://www.linkedin.com/company/acme", // a LinkedIn page is not the website
      linkedin: "https://uk.linkedin.com/company/acme-ai",
      x: "https://twitter.com/acme_ai?lang=en",
      people: [
        { name: "Jane Doe", role: "CEO", linkedin: "https://www.linkedin.com/company/acme", x: "not a url" },
        { name: " ", role: "", linkedin: null, x: null },
        ...Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, role: "", linkedin: null, x: null })),
      ],
      confidence: "certain",
    });
    assert.equal(l.website, null);
    assert.equal(l.linkedin, "https://uk.linkedin.com/company/acme-ai");
    assert.equal(l.x, "https://twitter.com/acme_ai?lang=en");
    assert.deepEqual(l.people[0], { name: "Jane Doe", role: "CEO", linkedin: null, x: null });
    assert.equal(l.people.length, 3);
    assert.equal(l.confidence, "low");
  });
});
