import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClassifiedJob, IcpVerdict, RunResult } from "../scraper/types.ts";
import { applyRun, buildLeads as buildFromStates, setStage, type ContraView, type JobState, type Pipeline } from "./pipeline.ts";

// Which jobs reach the lead dashboard, and how stages are kept.

function job(id: string, p: { decision?: IcpVerdict["decision"]; lane?: string | null; classifier?: string; signals?: string[] } = {}): ClassifiedJob {
  const { decision = "qualified", lane = "project", classifier = "anthropic:claude-sonnet-5-5", signals = [] } = p;
  return {
    id, title: `Job ${id}`, slug: id, url: `https://contra.com/opportunity/${id}`, createdAt: null, approvedAt: null, category: null,
    organization: null, country: null, hiringAsIndividual: true, description: null, budget: null, duration: null, roles: [], tools: [],
    timezone: { primaryUtcOffset: null, offsetTolerance: null },
    visitor: { applied: false, bookmarked: false, dismissed: false, viewed: false, matched: false },
    isNew: false, announce: false, lane: lane as ClassifiedJob["lane"],
    icp: { decision, tier: null, score: 8, reasons: [], signals, classifier },
  };
}

function run(ranAt: string, jobs: ClassifiedJob[], rejected: string[] = []): RunResult {
  return {
    ranAt, preset: "", classifier: "anthropic", totalScraped: 0, totalMatched: 0, newSinceLastRun: 0,
    counts: { qualified: 0, maybe: 0, rejected: 0 }, jobs,
    rejected: rejected.map((id) => ({ title: `Job ${id}`, url: `https://contra.com/opportunity/${id}`, reasons: [] })),
  };
}

const empty: Pipeline = { leads: {} };

/** Folds the runs in order, as the scraper saves them, then builds the leads. */
function buildLeads(runs: RunResult[], pipeline: Pipeline, contra?: ContraView) {
  const states = new Map<string, JobState>();
  const sorted = [...runs].sort((a, b) => a.ranAt.localeCompare(b.ranAt));
  for (const r of sorted) applyRun(states, r);
  return buildFromStates(states.values(), pipeline, sorted.at(-1)?.ranAt ?? "", contra);
}
const ids = (runs: RunResult[], p = empty) => buildLeads(runs, p).map((l) => l.id);

describe("buildLeads", () => {
  it("keeps qualified projects and full-time roles that fit even as a maybe", () => {
    const r = run("2026-10-13T10:00:00Z", [
      job("a"),
      job("b", { decision: "maybe" }),
      job("c", { decision: "maybe", lane: "outreach" }),
      job("d", { lane: "entry" }),
    ]);
    assert.deepEqual(ids([r]).sort(), ["a", "c"]);
  });

  it("skips regex verdicts and failed LLM calls", () => {
    const r = run("2026-10-13T10:00:00Z", [job("a", { classifier: "regex" }), job("b", { signals: ["llm-failed"] })]);
    assert.deepEqual(ids([r]), []);
  });

  it("keeps leads that left the board, marked off the board, with their first-seen date", () => {
    const leads = buildLeads([run("2026-10-12T10:00:00Z", [job("a")]), run("2026-10-13T10:00:00Z", [job("b")])], empty);
    const a = leads.find((l) => l.id === "a")!;
    assert.equal(a.onBoard, false);
    assert.equal(a.firstSeenAt, "2026-10-12T10:00:00Z");
    assert.equal(leads.find((l) => l.id === "b")!.onBoard, true);
  });

  it("drops a lead a later run rejected, unless it already has a stage", () => {
    const runs = [run("2026-10-12T10:00:00Z", [job("a"), job("b")]), run("2026-10-13T10:00:00Z", [], ["a", "b"])];
    assert.deepEqual(ids(runs), []);
    const staged = setStage(empty, "a", "Job a", "applied");
    const leads = buildLeads(runs, staged);
    assert.deepEqual(leads.map((l) => [l.id, l.stage]), [["a", "applied"]]);
  });

  it("defaults to new and reads the saved stage", () => {
    const r = run("2026-10-13T10:00:00Z", [job("a"), job("b")]);
    const leads = buildLeads([r], setStage(empty, "b", "Job b", "won"));
    assert.equal(leads.find((l) => l.id === "a")!.stage, "new");
    assert.equal(leads.find((l) => l.id === "b")!.stage, "won");
  });
  it("shows every job applied to on Contra, even one the AI layer never read or rejected", () => {
    const { description: _d, isNew: _n, announce: _a, icp: _i, lane: _l, ...record } = job("z");
    void [_d, _n, _a, _i, _l];
    const runs = [run("2026-10-12T10:00:00Z", [job("a"), job("r", { decision: "rejected", lane: null })])];
    const contra: ContraView = { applied: [record, job("r")], boardIds: new Set(["a", "r"]) };
    const leads = buildLeads(runs, empty, contra);
    const byId = new Map(leads.map((l) => [l.id, l]));
    // A rejected verdict stays out of the leads unless the job was applied to.
    assert.deepEqual([...byId.keys()].sort(), ["a", "r", "z"]);
    assert.deepEqual([byId.get("r")!.stage, byId.get("r")!.lane, byId.get("r")!.judged], ["applied", "project", true]);
    const z = byId.get("z")!;
    assert.deepEqual([z.stage, z.judged, z.appliedOnContra, z.onBoard], ["applied", false, true, false]);
    assert.deepEqual([byId.get("a")!.stage, byId.get("a")!.appliedOnContra], ["new", false]);
  });

  it("keeps a stage set by hand on an applied job, and reads on-the-board from the whole board", () => {
    const runs = [run("2026-10-12T10:00:00Z", [job("a")]), run("2026-10-13T10:00:00Z", [])];
    const leads = buildLeads(runs, setStage(empty, "a", "Job a", "talking"), { applied: [job("a")], boardIds: new Set(["a"]) });
    assert.deepEqual(leads.map((l) => [l.id, l.stage, l.onBoard]), [["a", "talking", true]]);
  });
});

describe("applyRun", () => {
  it("keeps the first-seen time and updates only the jobs a run touched", () => {
    const states = new Map<string, JobState>();
    applyRun(states, run("2026-10-12T10:00:00Z", [job("a"), job("b")]));
    const changed = applyRun(states, run("2026-10-13T10:00:00Z", [job("a")], ["b"]));
    assert.deepEqual(changed.map((c) => [c.id, c.rejected, c.firstSeenAt]).sort(), [
      ["a", false, "2026-10-12T10:00:00Z"],
      ["b", true, "2026-10-12T10:00:00Z"],
    ]);
  });

  it("gives the same states when the same run is applied twice", () => {
    const states = new Map<string, JobState>();
    const r = run("2026-10-12T10:00:00Z", [job("a")]);
    applyRun(states, r);
    const once = JSON.stringify([...states.values()]);
    applyRun(states, r);
    assert.equal(JSON.stringify([...states.values()]), once);
  });
});
