import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { minimalDetail, normalize, redactContact } from "./contra.ts";
import { LEAD_TOOLS, LEADS_DIR, cleanLead } from "./leads.ts";
import { ContraMcp } from "./mcp-client.ts";

// Guards for how we use Contra: read-only MCP access, and no other users' personal information stored.

const entry = (job: object) => ({
  job: {
    jobId: "j1",
    slug: "brand-identity",
    title: "Brand identity",
    publicUrl: "https://contra.com/opportunity/brand-identity",
    owner: { userProfile: { firstName: "Jane", lastName: "Doe", username: "janedoe" } },
    organization: { name: "Acme AI", isVerified: true },
    ...job,
  },
});

const detail = {
  ok: true,
  job: {
    owner: { userProfile: { firstName: "Jane", lastName: "Doe" } },
    blocknoteDescription: [{ type: "paragraph", content: [{ type: "text", text: "Email jane@acme.ai or call +1 (415) 555-0100. Series A." }] }],
  },
};

describe("Contra rules", () => {
  it("refuses any MCP tool that isn't read-only, before contacting Contra", async () => {
    const mcp = new ContraMcp("no-token");
    for (const tool of ["apply_to_job_confirm", "bookmark_job", "dismiss_job_feed_entry", "send_chat_message_confirm"]) {
      await assert.rejects(mcp.call(tool), /not a read-only tool/);
    }
  });

  it("never stores the poster's name", () => {
    const job = normalize(entry({}), detail)!;
    assert.ok(!JSON.stringify(job).includes("Jane"));
    assert.equal(job.organization?.name, "Acme AI");
  });

  it("drops the organization name for private individuals (often their own name)", () => {
    const job = normalize(entry({ hiringAsIndividual: true, organization: { name: "Jane Doe" } }), null)!;
    assert.equal(job.organization, null);
  });

  it("keeps only the description, with contact details removed", () => {
    const min = minimalDetail(detail)!;
    assert.deepEqual(Object.keys(min.job), ["description"]);
    assert.equal(min.job.description, "Email [email removed] or call [phone removed]. Series A.");
    assert.equal(minimalDetail({ ok: false }), null);
  });

  it("leaves budgets, years and short numbers alone", () => {
    assert.equal(redactContact("Budget $12,000 for 2026, team of 25"), "Budget $12,000 for 2026, team of 25");
  });

  it("keeps contra.com out of the lead lookup's web search, web fetch and results", () => {
    assert.deepEqual(LEAD_TOOLS.map((t) => [t.name, t.blocked_domains]), [["web_search", ["contra.com"]], ["web_fetch", ["contra.com"]]]);
    const lead = cleanLead({ website: "https://contra.com/acme", linkedin: "https://contra.com/in/jane", people: [] });
    assert.equal(lead.website, null);
    assert.equal(lead.linkedin, null);
  });

  it("never commits the people the lead lookup finds", () => {
    const repo = path.resolve(import.meta.dirname, "..");
    const ignored = readFileSync(path.join(repo, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
    assert.equal(path.relative(repo, LEADS_DIR), path.join("data", "leads"));
    assert.ok(ignored.includes("/data/leads/"), "data/leads/ must be gitignored");
  });
});
