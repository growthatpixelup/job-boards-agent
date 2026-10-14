import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appliedFromPages, toMarkApplied } from "./applied.ts";

describe("applied sync", () => {
  it("keeps only id and title of applied jobs, skipping ads and unapplied entries", () => {
    const pages = [
      { entries: [{ job: { jobId: "a", title: "Brand", owner: { firstName: "Jane" } }, visitorDidApply: true }, { job: null }] },
      { entries: [{ job: { jobId: "b", title: "Site" }, visitorDidApply: false }, { job: { jobId: "a", title: "Brand" }, visitorDidApply: true }] },
    ];
    assert.deepEqual(appliedFromPages(pages), [{ id: "a", title: "Brand" }]);
  });

  it("marks only jobs with no stage or still New or Priority, never overwriting a stage set by hand", () => {
    const applied = ["a", "b", "c", "d", "e"].map((id) => ({ id, title: id }));
    const stages = [
      { id: "b", stage: "new" },
      { id: "c", stage: "talking" },
      { id: "d", stage: "passed" },
      { id: "e", stage: "priority" },
    ];
    assert.deepEqual(toMarkApplied(applied, stages).map((a) => a.id), ["a", "b", "e"]);
  });
});
