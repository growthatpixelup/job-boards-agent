import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { blocknoteToText } from "../contra.ts";
import type { BudgetType, Job } from "../types.ts";
import { LLM_FAILED, createLlmClassifier, parseVerdict } from "./llm.ts";
import { classifyRegex, prescreen, raisedMillions } from "./regex.ts";

function job(p: Omit<Partial<Job>, "budget"> & { budget?: [BudgetType, number, number] | null } = {}): Job {
  const { budget = ["FIXED", 10_000, 20_000], ...rest } = p;
  return {
    id: "j1",
    title: "Untitled",
    slug: "untitled",
    url: "https://contra.com/opportunity/untitled",
    createdAt: "2026-10-06T00:00:00Z",
    approvedAt: null,
    category: null,
    organization: { name: "Acme", isVerified: false },
    country: null,
    hiringAsIndividual: false,
    description: "",
    budget: budget ? { type: budget[0], feeMin: budget[1], feeMax: budget[2], estimatedHours: null } : null,
    duration: null,
    roles: [],
    tools: [],
    timezone: { primaryUtcOffset: null, offsetTolerance: null },
    visitor: { applied: false, bookmarked: false, dismissed: false, viewed: false, matched: false },
    ...rest,
  };
}

const decide = (j: Job) => classifyRegex(j).decision;
const has = (j: Job, signal: string) => classifyRegex(j).signals.includes(signal);

describe("qualified jobs (bullseye + acceptable rings)", () => {
  it("Carol: AI-native B2B, Series A, going upmarket, brand + site, premium budget", () => {
    const v = classifyRegex(
      job({
        title: "Rebrand + new marketing website for AI infrastructure startup",
        roles: ["Brand Designer", "Web Designer"],
        description:
          "We're a Series A AI infrastructure company (backed by Accel, raised $12M). Our site looks generic and we're moving upmarket to enterprise customers — buyers ask about SOC 2 and we need to look credible. Founder-led, decision in a week. Launching at a conference in 8 weeks.",
      }),
    );
    assert.equal(v.decision, "qualified");
    assert.equal(v.tier, "carol");
    assert.ok(v.signals.includes("+3 ai-native") && v.signals.includes("+3 series-a-b"));
  });

  it("Diana: funded B2B fintech SaaS website redesign", () => {
    const v = classifyRegex(
      job({
        title: "Website redesign for fintech SaaS",
        roles: ["Web Designer"],
        description: "B2B SaaS for finance teams. Seed-funded, we raised $4M last year. Need a website redesign that tells our story.",
        budget: ["FIXED", 8_000, 12_000],
      }),
    );
    assert.equal(v.decision, "qualified");
    assert.equal(v.tier, "diana");
  });

  it("Carol: product UI/UX for an AI copilot with enterprise customers, hourly", () => {
    const v = classifyRegex(
      job({
        title: "UI/UX designer for AI copilot dashboard",
        roles: ["Product Designer"],
        description: "Series B, enterprise customers in healthcare. We need a product designer and a design system for our LLM copilot.",
        budget: ["HOURLY", 80, 120],
      }),
    );
    assert.equal(v.decision, "qualified");
    assert.equal(v.tier, "carol");
  });
});

describe("real Contra jobs from the feed (2026-10-07)", () => {
  it("rejects the CLRITY video-editing job (not a service we sell)", () => {
    const v = classifyRegex(
      job({
        title: "Creative Video Editor Brand Launch Film",
        roles: ["Video Editor", "AI Video Producer", "Film Producer"],
        description: "Rebuild its brand launch film around updated brand identity, messaging and positioning … art direction.",
        budget: ["FIXED", 600, 1_200],
      }),
    );
    assert.equal(v.decision, "rejected");
    assert.ok(v.signals.includes("reject:out-of-scope"));
  });

  it("rejects Codium's website animations (animation-only, design already complete)", () => {
    const v = classifyRegex(
      job({
        title: "Website Dynamic Animations ",
        roles: ["2D Animator"],
        tools: ["JavaScript"],
        description: "We have designed animations throughout a website … The design and content is complete.",
        budget: ["FIXED", 2_000, 4_000],
      }),
    );
    assert.equal(v.decision, "rejected");
  });

  it("rejects RedirHub's customer-development role", () => {
    const v = classifyRegex(
      job({
        title: "Customer Development & Partnerships Lead for B2B SaaS (Contract, Remote)",
        roles: ["Customer Success Manager", "Business Development Specialist"],
        budget: ["WEEKLY", 250, 500],
      }),
    );
    assert.equal(v.decision, "rejected");
  });
});

describe("real closed Contra jobs with descriptions (2026-10-07)", () => {
  it("rejects Mainstay's vitamin-packet brand + packaging (B2C / CPG)", () => {
    const j = job({
      title: "Brand Identity & Packaging Designer for Supplement Startup",
      roles: ["Brand Designer", "Packaging Designer"],
      description:
        "Launch of our daily vitamin packet brand, sold via monthly subscription. The foundation, including the logo and direction, is already established. Print-ready designs for a carton and sachet.",
      budget: ["FIXED", 1_500, 3_000],
    });
    assert.ok(has(j, "reject:b2c"));
  });

  it("rejects Venn's $25–40/hr Webflow page work against an existing brand system", () => {
    const j = job({
      title: "Webflow Designer for Brand Development at Venn",
      roles: ["Web Designer", "Visual Designer"],
      description: "Design and build Webflow page mockups. Apply our existing brand system and visual direction.",
      budget: ["HOURLY", 25, 40],
    });
    assert.equal(decide(j), "rejected");
  });

  it("qualifies OKTAI's AI-product website design + build (individual poster, no funding info → eddie)", () => {
    const v = classifyRegex(
      job({
        title: "Modern Website Designer/Developer Needed",
        roles: ["Web Developer", "Frontend Engineer", "UX Engineer"],
        hiringAsIndividual: true,
        description: "Design and build a complete, launch-ready marketing website for OKTAI Computer, our AI product.",
        budget: ["FIXED", 10_000, 14_000],
      }),
    );
    assert.equal(v.decision, "qualified");
    assert.equal(v.tier, "eddie");
    assert.ok(v.signals.includes("service:development"));
  });

  it("holds Flowdeck's devtool logo refinement at maybe and ignores 'not a full rebrand'", () => {
    const j = job({
      title: " Iterate/Refine logo design",
      roles: ["Brand Designer", "Graphic Designer", "Logo Designer"],
      description: "Improve the existing identity for a macOS developer tool. This is a refinement project, not a full rebrand.",
      budget: ["HOURLY", 30, 60],
    });
    assert.equal(decide(j), "maybe");
    assert.ok(!has(j, "+1 trigger-rebrand"));
  });
});

describe("deal-breakers (doc §4 anti-market)", () => {
  const base = { title: "Brand identity design", roles: ["Brand Designer"] };
  const cases: [string, string, string][] = [
    ["crypto", "We are a DeFi protocol launching our token.", "reject:crypto"],
    ["pre-PMF", "We're a pre-seed startup validating our idea.", "reject:pre-pmf"],
    ["equity-only", "Compensation is equity-only for now.", "reject:pre-pmf"],
    ["cost-shopper", "We have a tight budget so looking for the cheapest option.", "reject:cost-shopper"],
    ["committee", "Please respond to our RFP; final selection by the brand committee.", "reject:committee"],
    ["on-site", "You must be based in the US. US citizens only.", "reject:on-site"],
    ["execution-only", "Our designs are complete in Figma, we need someone to convert our Figma designs into Webflow.", "reject:execution-only"],
    ["agency", "We're a branding agency looking for white-label help on our client's brand.", "reject:agency"],
    ["B2C", "We sell skincare through our Shopify store.", "reject:b2c"],
    ["raised < $2M", "B2B SaaS, we raised $800k from angels.", "reject:raised-under-2m"],
    ["team > 500", "B2B SaaS with 2000 employees.", "reject:team-over-500"],
  ];
  for (const [name, description, signal] of cases) {
    it(`rejects ${name}`, () => {
      const j = job({ ...base, description });
      assert.equal(decide(j), "rejected");
      assert.ok(has(j, signal), `expected ${signal}, got ${classifyRegex(j).signals.join(", ")}`);
    });
  }

  it("flags full-time roles instead of rejecting them", () => {
    const j = job({ ...base, description: "B2B SaaS, Series A. This is a full-time position with health insurance." });
    assert.equal(decide(j), "maybe");
    assert.ok(has(j, "flag:full-time"));
  });

  it("rejects a budget below the floor", () => {
    const j = job({ ...base, description: "B2B SaaS, Series A.", budget: ["FIXED", 300, 500] });
    assert.ok(has(j, "reject:budget-floor"));
  });

  it("counts 'Framer Motion' React work as development, not a Framer site", () => {
    const j = job({ title: "React developer with Framer Motion", roles: ["Frontend Developer"] });
    assert.ok(has(j, "service:development"));
    assert.ok(!has(j, "service:website"));
  });

  it("rejects when nothing in the post asks for design", () => {
    assert.ok(has(job({ title: "Help needed", description: "Looking for help with operations." }), "reject:no-service"));
  });
});

describe("maybe (service fits, evidence thin or budget below entry)", () => {
  const funded = "B2B SaaS, Series A, enterprise customers.";
  it("missing description", () => {
    const v = classifyRegex(job({ title: "Brand identity", roles: ["Brand Designer"], description: null }));
    assert.equal(v.decision, "maybe");
  });
  it("budget below the $10,000 minimum project", () => {
    const v = classifyRegex(job({ title: "Product design for our SaaS", description: funded, budget: ["FIXED", 6_000, 8_000] }));
    assert.equal(v.decision, "maybe");
  });
  it("logo-only ask", () => {
    assert.equal(decide(job({ title: "Logo design", roles: ["Logo Designer"], description: funded })), "maybe");
  });
  it("no client-fit evidence", () => {
    assert.equal(decide(job({ title: "Website redesign", description: "We need a fresh website." })), "maybe");
  });
  it("consumer words next to B2B (vertical SaaS for restaurants)", () => {
    assert.equal(decide(job({ title: "Website redesign", description: "B2B SaaS for restaurant owners. Series A." })), "maybe");
  });
  it("design + non-custom stack title", () => {
    assert.equal(decide(job({ title: "Website redesign + WordPress developer", description: funded })), "maybe");
  });
  it("development job building from finished designs", () => {
    const j = job({
      title: "React developer for SaaS dashboard",
      roles: ["Frontend Developer"],
      description: `${funded} Our designs are complete in Figma; convert our Figma designs into React.`,
    });
    assert.equal(decide(j), "maybe");
    assert.ok(has(j, "cap:execution-only"));
  });
});

describe("custom development (Next.js / React)", () => {
  const funded = "B2B SaaS, Series A, enterprise customers.";
  it("qualifies a Next.js marketing-site build for a funded B2B SaaS", () => {
    const j = job({ title: "Next.js developer for our marketing site", roles: ["Frontend Developer"], description: funded });
    assert.equal(decide(j), "qualified");
    assert.ok(has(j, "service:development"));
  });
  it("qualifies React, NextJS and custom-development titles", () => {
    for (const title of ["Senior React engineer", "NextJS web app build", "Custom web app development for our AI platform", "Frontend developer"]) {
      assert.ok(has(job({ title, description: funded }), "service:development"), title);
    }
  });
  it("lets a design + development scope qualify (no implementation cap)", () => {
    assert.equal(decide(job({ title: "Webflow developer for website redesign", description: funded })), "qualified");
  });
  it("keeps React Native, WordPress and backend-only work out of scope", () => {
    assert.equal(decide(job({ title: "React Native developer", roles: ["Mobile Developer"], description: funded })), "rejected");
    assert.equal(decide(job({ title: "WordPress web developer", roles: ["Web Developer"], description: funded })), "rejected");
    assert.equal(decide(job({ title: "Backend engineer (Go)", roles: ["Backend Developer"], description: funded })), "rejected");
  });
  it("still rejects Figma-to-Webflow conversions on design-only asks", () => {
    const j = job({ title: "Brand identity design", description: "Our designs are complete in Figma, convert our Figma designs into Webflow." });
    assert.ok(has(j, "reject:execution-only"));
  });
  it("design ask only in the description", () => {
    const v = classifyRegex(job({ title: "Project for Acme", description: `We need a website redesign. ${funded}` }));
    assert.equal(v.decision, "maybe");
  });
});

describe("helpers", () => {
  it("parses raised amounts in USD millions", () => {
    assert.deepEqual(raisedMillions("We raised $12M from Accel"), [12]);
    assert.deepEqual(raisedMillions("closed a $500k seed round"), [0.5]);
    assert.deepEqual(raisedMillions("raised $1.5 million"), [1.5]);
    assert.deepEqual(raisedMillions("$25M Series A"), [25]);
  });

  it("prescreen skips out-of-scope titles but keeps design jobs for detail fetch", () => {
    assert.equal(prescreen(job({ title: "Video editor", roles: ["Video Editor"] })).fetchDetail, false);
    assert.equal(prescreen(job({ title: "Brand identity", description: null })).fetchDetail, true);
  });

  it("flattens BlockNote descriptions", () => {
    const text = blocknoteToText([
      { type: "heading", content: [{ type: "text", text: "About us" }], children: [] },
      { type: "paragraph", content: [{ type: "text", text: "We use " }, { type: "link", content: [{ type: "text", text: "Rive" }] }] },
      { type: "bulletListItem", content: [{ type: "text", text: "Ship fast" }], children: [] },
    ]);
    assert.equal(text, "About us\nWe use Rive\n- Ship fast");
  });
});

describe("LLM classifier plumbing (fake provider)", () => {
  const good = job({ title: "Brand identity", roles: ["Brand Designer"], description: "Series A B2B SaaS." });

  it("parses a provider verdict", () => {
    const v = parseVerdict('{"decision":"qualified","tier":"diana","confidence":0.8,"reasons":["Series A B2B"],"deal_breakers":[]}', "test");
    assert.deepEqual([v.decision, v.tier, v.score], ["qualified", "diana", 8]);
  });

  it("sends every job to the LLM (one layer, no regex pre-cut) and falls back to regex on errors", async () => {
    let calls = 0;
    const failing = createLlmClassifier(
      async () => {
        calls++;
        throw new Error("boom");
      },
      "fake",
      { cacheDir: null },
    );
    // A small budget the regex floor rejects outright still reaches the LLM: it could be an entry project.
    await failing(job({ title: "Logo for our Series A AI startup", roles: ["Logo Designer"], budget: ["FIXED", 1_500, 2_000] }));
    await failing(job({ title: "Video editor", roles: ["Video Editor"] }));
    assert.equal(calls, 2);
    const v = await failing(good);
    assert.match(v.classifier, /fell back to regex/);
    assert.ok(v.signals.includes(LLM_FAILED));
    assert.notEqual(v.decision, "qualified"); // only jobs the LLM has read may qualify (and reach Slack)
  });

  const verdict = (fields: object) =>
    JSON.stringify({
      decision: "qualified", tier: "diana", sprint_types: ["brand"], scope: "logo", estimated_value_usd: 2_500,
      value_basis: "fixed", full_time: false, growth_potential: "none", growth_path: "", confidence: 0.8,
      reasons: ["B2B"], deal_breakers: [], ...fields,
    });

  it("caps a qualified verdict below the $10,000 minimum at maybe", () => {
    const v = parseVerdict(
      '{"decision":"qualified","tier":"diana","sprint_types":["product-design-dev"],"scope":"3 screens","estimated_value_usd":1500,"value_basis":"$100/hr × 15 hrs","confidence":0.9,"reasons":["B2B"],"deal_breakers":[]}',
      "test",
    );
    assert.equal(v.decision, "maybe");
    assert.equal(v.project?.estimatedValueUsd, 1500);
    assert.equal(v.project?.growthPotential, "none");
  });

  it("keeps a small entry project qualified when growth potential is high", () => {
    const v = parseVerdict(verdict({ growth_potential: "high", growth_path: "logo → brand sprint → site" }), "test");
    assert.equal(v.decision, "qualified");
    assert.deepEqual([v.project?.growthPotential, v.project?.growthPath], ["high", "logo → brand sprint → site"]);
  });

  it("caps small jobs at maybe unless growth potential is high and the entry minimum is met", () => {
    assert.equal(parseVerdict(verdict({ growth_potential: "medium" }), "test").decision, "maybe");
    const tiny = parseVerdict(verdict({ growth_potential: "high", estimated_value_usd: 600 }), "test");
    assert.equal(tiny.decision, "maybe");
    assert.match(tiny.reasons.at(-1)!, /entry project/);
  });

  it("caches verdicts per job and re-asks when the job changes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "verdicts-"));
    let calls = 0;
    const classify = createLlmClassifier(
      async () => {
        calls++;
        return '{"decision":"qualified","tier":"diana","sprint_types":["brand"],"scope":"rebrand","estimated_value_usd":25000,"value_basis":"fixed","confidence":0.8,"reasons":[],"deal_breakers":[]}';
      },
      "fake",
      { cacheDir: dir },
    );
    assert.equal((await classify(good)).decision, "qualified");
    assert.equal((await classify(good)).decision, "qualified");
    assert.equal(calls, 1);
    await classify({ ...good, description: "Series A B2B SaaS. Now with a bigger scope." });
    assert.equal(calls, 2);
    await rm(dir, { recursive: true, force: true });
  });
});
