import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClassifiedJob, IcpVerdict, RunResult } from "../scraper/types.ts";
import { applyRun, buildLeads as buildFromStates, setStage, type JobState, type Pipeline } from "./pipeline.ts";

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
function buildLeads(runs: RunResult[], pipeline: Pipeline) {
  const states = new Map<string, JobState>();
  const sorted = [...runs].sort((a, b) => a.ranAt.localeCompare(b.ranAt));
  for (const r of sorted) applyRun(states, r);
  return buildFromStates(states.values(), pipeline, sorted.at(-1)?.ranAt ?? "");
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
