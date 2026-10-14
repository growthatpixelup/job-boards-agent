import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeSync } from "./contra-sync.ts";

describe("describeSync", () => {
  it("says what moved and flags unread conversations", () => {
    assert.equal(describeSync({ applied: 3, moved: 1, unreadConversations: 2 }), "1 job moved to Applied · 3 applied on Contra · 2 unread conversations on Contra");
  });
  it("stays quiet when nothing changed", () => {
    assert.equal(describeSync({ applied: 3, moved: 0, unreadConversations: 0 }), "Applied stages already up to date · 3 applied on Contra");
  });
});
