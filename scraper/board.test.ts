import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boardOf } from "./board.ts";
import type { ClassifiedJob, Job } from "./types.ts";

// What the "All jobs" page gets from a run.

const job = (id: string): Job => ({
  id, title: `Job ${id}`, slug: id, url: `https://contra.com/opportunity/${id}`, createdAt: null, approvedAt: null, category: null,
  organization: { name: "Acme", isVerified: false }, country: null, hiringAsIndividual: false,
  description: "Long post with a name and details", budget: null, duration: null, roles: ["Brand Designer"], tools: [],
  timezone: { primaryUtcOffset: null, offsetTolerance: null },
  visitor: { applied: id === "c", bookmarked: false, dismissed: false, viewed: false, matched: false },
});

describe("board", () => {
  it("keeps every job in feed order, without descriptions, with a slim verdict", () => {
    const judged: ClassifiedJob = {
      ...job("a"), isNew: true, announce: true, lane: "project", applicationBrief: "brief",
      icp: {
        decision: "qualified", tier: "diana", score: 8, reasons: ["one", "two", "three"], signals: ["x"], classifier: "anthropic",
        project: {
          sprintTypes: ["brand"], scope: "rebrand", hourlyRateUsd: 100, estimatedHours: 50, estimatedValueUsd: 5000, basis: "long basis",
          clientType: "b2b", fullTime: false, growthPotential: "none", growthPath: "", concerns: ["agency"],
        },
      },
    };
    const board = boardOf([job("c"), job("a"), job("b")], [judged, { ...judged, ...job("b"), icp: { ...judged.icp, decision: "rejected", project: undefined }, lane: null }]);
    assert.deepEqual(board.map((j) => j.id), ["c", "a", "b"]);
    assert.ok(board.every((j) => !("description" in j)), "descriptions are never stored");
    assert.equal(board[0].icp, undefined, "an applied job the scrape skipped has no verdict");
    assert.deepEqual(board[1].icp, { decision: "qualified", reasons: ["one", "two"], project: { scope: "rebrand", estimatedValueUsd: 5000, fullTime: false, concerns: ["agency"] } });
    assert.deepEqual([board[2].icp?.decision, board[2].lane], ["rejected", null]);
    assert.ok(!JSON.stringify(board).includes("brief") && !JSON.stringify(board).includes("long basis"));
  });
});
