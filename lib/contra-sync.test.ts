import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeSync, isFinished } from "./contra-sync.ts";

describe("describeSync", () => {
  it("says what moved and flags unread conversations", () => {
    assert.equal(describeSync({ applied: 3, moved: 1, closed: 4, unreadConversations: 2 }), "1 job moved to Applied · 3 applied on Contra · 4 closed on Contra · 2 unread conversations on Contra");
  });
  it("stays quiet when nothing changed", () => {
    assert.equal(describeSync({ applied: 3, moved: 0, closed: 0, unreadConversations: 0 }), "Applied stages already up to date · 3 applied on Contra");
  });
});

describe("isFinished", () => {
  it("is true only for a job Contra reports closed or expired", () => {
    assert.equal(isFinished({ ok: true, job: { status: "CLOSED" } }), true);
    assert.equal(isFinished({ ok: true, job: { status: "EXPIRED" } }), true);
    assert.equal(isFinished({ ok: true, job: { status: "POSTED" } }), false);
    assert.equal(isFinished({ ok: false }), false); // an error isn't proof the job finished
    assert.equal(isFinished(null), false);
  });
});
