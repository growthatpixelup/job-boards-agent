import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appliedFromPages, toMarkApplied } from "./applied.ts";

describe("applied sync", () => {
  it("keeps applied jobs once each, skipping ads and unapplied entries", () => {
    const pages = [
      { entries: [{ job: { jobId: "a", title: "Brand", slug: "a-brand", owner: { firstName: "Jane" } }, visitorDidApply: true }, { job: null }] },
      { entries: [{ job: { jobId: "b", title: "Site" }, visitorDidApply: false }, { job: { jobId: "a", title: "Brand", slug: "a-brand" }, visitorDidApply: true }] },
    ];
    const applied = appliedFromPages(pages);
    assert.deepEqual(applied.map((a) => [a.id, a.title]), [["a", "Brand"]]);
    // The feed record goes to the Applied tab: the job's own fields, marked applied, never a description or the poster.
    const job = applied[0].job!;
    assert.equal(job.url, "https://contra.com/opportunity/a-brand");
    assert.equal(job.visitor.applied, true);
    assert.ok(!("description" in job));
    assert.ok(!JSON.stringify(applied).includes("Jane"));
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
