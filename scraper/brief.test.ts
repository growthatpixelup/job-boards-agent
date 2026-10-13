import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { addBriefs, briefProblems, cleanBrief, needsBrief, type BriefWriter } from "./brief.ts";
import { LLM_FAILED } from "./icp/llm.ts";
import type { ClassifiedJob, IcpVerdict } from "./types.ts";

// Which jobs get an application brief, the cache, and what counts as a usable brief.

function job(id: string, p: { decision?: IcpVerdict["decision"]; lane?: ClassifiedJob["lane"]; signals?: string[]; description?: string } = {}): ClassifiedJob {
  const { decision = "qualified", lane = "project", signals = [], description = "We need a rebrand." } = p;
  return {
    id, title: `Job ${id}`, slug: id, url: `https://contra.com/opportunity/${id}`, createdAt: null, approvedAt: null, category: null,
    organization: { name: `Company ${id}`, isVerified: false }, country: null, hiringAsIndividual: false, description,
    budget: { type: "FIXED", feeMin: 10_000, feeMax: 15_000, estimatedHours: null }, duration: null, roles: [], tools: [],
    timezone: { primaryUtcOffset: null, offsetTolerance: null },
    visitor: { applied: false, bookmarked: false, dismissed: false, viewed: false, matched: false },
    isNew: true, announce: false, lane,
    icp: { decision, tier: null, score: 8, reasons: [], signals, classifier: "test" },
  };
}

function fakeWriter(name = "fake"): BriefWriter & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    async write(j) {
      calls.push(j.id);
      if (j.description?.includes("FAIL")) throw new Error("boom");
      return `Brief for ${j.id}`;
    },
  };
}

const tmp = () => mkdtemp(path.join(os.tmpdir(), "briefs-"));

describe("needsBrief", () => {
  it("covers qualified projects only: not maybes, full-time roles, rejections or unchecked jobs", () => {
    assert.equal(needsBrief(job("a")), true);
    assert.equal(needsBrief(job("b", { decision: "maybe" })), false);
    assert.equal(needsBrief(job("c", { lane: "outreach" })), false);
    assert.equal(needsBrief(job("d", { decision: "rejected", lane: null })), false);
    assert.equal(needsBrief(job("e", { signals: [LLM_FAILED] })), false);
  });
});

describe("addBriefs", () => {
  it("writes each brief once, then serves it from the cache", async () => {
    const dir = await tmp();
    const writer = fakeWriter();
    const jobs = [job("a"), job("b", { lane: "outreach" })];
    assert.deepEqual(await addBriefs(jobs, writer, { dir }), { written: 1, cached: 0, failed: 0 });
    assert.equal(jobs[0].applicationBrief, "Brief for a");
    assert.equal(jobs[1].applicationBrief, undefined);

    const again = [job("a")];
    assert.deepEqual(await addBriefs(again, writer, { dir }), { written: 0, cached: 1, failed: 0 });
    assert.equal(again[0].applicationBrief, "Brief for a");
    assert.deepEqual(writer.calls, ["a"]);
  });

  it("rewrites when the job or the writer changes", async () => {
    const dir = await tmp();
    const writer = fakeWriter();
    await addBriefs([job("a")], writer, { dir });
    await addBriefs([job("a", { description: "We need a rebrand and a site." })], writer, { dir });
    await addBriefs([job("a", { description: "We need a rebrand and a site." })], fakeWriter("other-model"), { dir });
    assert.deepEqual(writer.calls, ["a", "a"]);
  });

  it("leaves a failed job without a brief, to retry next run", async () => {
    const dir = await tmp();
    const jobs = [job("a", { description: "FAIL" }), job("b")];
    assert.deepEqual(await addBriefs(jobs, fakeWriter(), { dir }), { written: 1, cached: 0, failed: 1 });
    assert.equal(jobs[0].applicationBrief, undefined);
    assert.deepEqual(await readdir(dir), ["b.json"]);
  });

  it("without a writer, uses any cached brief and writes nothing", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, "a.json"), JSON.stringify({ key: "old", brief: "Cached brief" }));
    const jobs = [job("a"), job("b")];
    assert.deepEqual(await addBriefs(jobs, null, { dir }), { written: 0, cached: 1, failed: 0 });
    assert.equal(jobs[0].applicationBrief, "Cached brief");
    assert.equal(jobs[1].applicationBrief, undefined);
  });

  it("drops cached briefs for jobs that left the feed", async () => {
    const dir = await tmp();
    await addBriefs([job("a"), job("b")], fakeWriter(), { dir });
    await addBriefs([job("a")], fakeWriter(), { dir, feedIds: new Set(["a"]) });
    assert.deepEqual(await readdir(dir), ["a.json"]);
  });
});

describe("brief text", () => {
  it("strips markdown for a plain form field", () => {
    assert.equal(cleanBrief("## Hi\n\n\n\n**Bold** move.  \n"), "Hi\n\nBold move.");
  });

  it("flags briefs Contra's form can't take", () => {
    assert.deepEqual(briefProblems("A good brief."), []);
    assert.match(briefProblems("x".repeat(1501)).join(), /1501 characters/);
    assert.match(briefProblems("See https://pixeluplabs.com").join(), /link/);
    assert.match(briefProblems("Mail hi@pixelup.in").join(), /email/);
    assert.match(briefProblems("").join(), /empty/);
  });
});
