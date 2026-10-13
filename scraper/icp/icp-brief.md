# Pixelup Labs — ICP brief for qualifying Contra jobs

Source: "Pixelup Labs — Positioning & ICP Engine" (July 2026), with the qualifying rule set in October 2026.
This is the rubric the LLM classifier receives verbatim for every job on the board. The regex classifier
(`regex.ts`) is an older, stricter version of these rules, used only for the free local mode and as the
stand-in when an LLM call fails. The numbers live in `criteria.ts`; keep them in sync with this brief.

## Who we are

Pixelup Labs is the **enterprise-readiness design partner for funded B2B (mostly AI-native) startups**.
We rebuild a startup's brand, website and product design around the opinion the founder holds about
their market, so enterprise buyers stop hesitating. Founder-to-founder, senior team, ships in weeks
(2-week brand sprints, ~3-week sites, ~5 weeks for brand + site). Mainline sprints are $25–30k and
retainers start at $4k/month. Bangalore-based, SF-calibrated.

On Contra we qualify **any job for work we sell that meets the money rule**, whoever the client is.
Who the client is still matters for how we pitch, so you also rate client fit and flag concerns.

## Services that qualify a job (at least one must be the core of the job)

- Brand identity / rebrand / visual identity / brand strategy, positioning & messaging
- Website / marketing site / landing page design or redesign (incl. Webflow or Framer builds we design)
- Product design: UI/UX for a SaaS or AI product, dashboards, web apps
- Design systems, component libraries, ongoing design retainers
- Pitch, investor or sales decks
- Custom development: Next.js / React websites and web apps, front-end builds, custom-coded sites
  (building from someone else's finished designs is fine here)

Not our service (reject when it is the core of the job): video editing, animation-only, motion-only,
3D, illustration-only, photography, copywriting/content-only, SEO, ads/performance marketing, lead
generation, social media management, sales/BD/customer success, engineering outside Next.js/React
(backend-only, mobile incl. React Native/Flutter, data/ML, DevOps), Shopify/WordPress/Wix/Squarespace
builds, virtual assistance, and pixel-pushing: turning a design someone else has finished into a
Webflow/Framer/no-code site ("convert our Figma to Webflow", "just implement").

## The money rule

A job qualifies on money when both hold:

- **Rate: at least $50/hour.** For an hourly job, that is the stated rate (the top of its range). For a
  fixed-price, weekly or monthly budget, it is the effective rate: the budget ÷ the hours the scope
  realistically needs.
- **Total: more than $3,500**, the rate × the hours: the hours the post states, or else the hours the
  described scope realistically needs. A retainer counts its fee over its stated or likely length.

Read the whole post and estimate the hours from what it actually asks for, not from its title. A high
rate on a tiny scope can still fail the total ($100/hr for 3 screens is ~15 hours, ~$1,500), and a large
fixed budget can fail the rate ($4,000 for a 15-page site with a CMS is ~120 hours, ~$33/hr). Report
`hourly_rate_usd`, `estimated_hours` and `estimated_value_usd` (= rate × hours) as single numbers (the middle
of a range) and show the working in `value_basis`, e.g. "$60/hr × ~80 hrs for a 10-page marketing site".
Always estimate the hours. Only if the post states no budget, set the rate and value to null: the money
can't be judged.

No cash pay (equity-only, revenue share, unpaid, "exposure") fails the money rule.

## Entry projects (small now, could grow)

Some clients test the waters with a small first project before they hand over the bigger work: we have had
a client start with a logo and grow into a full engagement. A job that pays at least $50/hr but totals
$3,500 or less still qualifies as an entry project when its growth potential is high and it pays at least
$1,000. Rate `growth_potential` for every job:

- **high**: a client that can afford more (a funded or clearly well-resourced company, ideally B2B and
  AI-native) whose small ask is the first piece of work we sell: a logo or landing page for a funded startup
  with no real brand or site yet, a brand refresh that will need a site to match, a few screens of a product
  that is clearly growing, or the post says more work follows ("first phase", "trial project", "ongoing",
  "long-term", "if this goes well").
- **medium**: a plausible but unstated path to bigger work.
- **low**: a self-contained one-off (a logo for a side project, small fixes, a single asset), or a client
  unlikely to spend more.
- **none**: the work isn't something we sell.

Write `growth_path` as the likely next steps (e.g. "logo → brand sprint → marketing site"), or leave it
empty. For a larger job it says whether the work could become a retainer or more projects.

## Full-time roles

A full-time or in-house role is judged like any other job and gets `full_time` true. Its rate is the pay's
hourly equivalent (an annual salary ÷ 2,080 hours, a monthly one ÷ 173), its hours ~1,040 (about six months
full-time) and its total the rate × those hours, unless the post says otherwise. We won't take the seat;
we'll reach out to the company on a different platform and pitch a project instead.

## Client fit (sets the tier, informs growth and the pitch; never the decision)

| | Bullseye — "Carol" | Acceptable — "Diana/Eddie" | Outside our ICP |
|---|---|---|---|
| Category | AI-native B2B software (infra, devtools, vertical AI, applied AI) | Any B2B software/SaaS; fintech-, healthcare-, legal-serving tech | B2C, agencies, services, crypto/web3, pre-product |
| Stage | Series A – Series B (incl. fast seed→A breakouts) | Late seed with $3M+ raised; Series C | Pre-seed, unraised, mid-pivot |
| Raised | $5M–$60M | $3M–$150M | < $2M |
| Team | 10–80 | 5–200 | > 500 |
| Geo | SF Bay Area | US, UK, EU, AUS, SG, premium remote | Primarily-India / low-budget markets |
| Motion | PLG→sales-led; "Contact sales" tier; first AE/SDR hires | Enterprise-only sales | Pure self-serve, no enterprise ambition |
| Competition | Saturated or legacy-incumbent-dominated ("modern alternative to X") | Category creators | Monopolies with no perception pressure |

- **carol** = AI-native B2B + (Series A/B or a visible going-upmarket/enterprise signal).
- **diana** = any funded B2B software startup raising or moving upmarket.
- **eddie** = any other client, including those outside our ICP.

Positive signals: funding (Series A/B, a named top-tier investor or YC, "just raised", $5M–$60M raised);
going upmarket (enterprise buyers, Fortune 500, SOC 2, "contact sales", needs to look credible);
inciting events (rebrand, launch, conference, site looks generic or outdated, outgrown the brand); an
opinionated, founder-led buyer; wanting systems, a retainer or a long-term partnership; testing the
waters with a small first project.

## Concerns (flag them; they don't change the decision)

Put the id of each that applies in `concerns`, so the team sees them before applying. Nothing else counts:
not unknown funding or stage, timelines, the role being full-time, or how sure you are of an estimate.

- `b2c`: B2C/consumer brand (e-commerce, DTC, CPG, food & drink, coaches, personal brands, real estate, fashion…)
- `crypto`: crypto/web3/NFT/DeFi
- `pre-pmf`: the post says it is pre-PMF, idea stage, unfunded or mid-pivot
- `agency`: agency, white-label or subcontract work for someone else's client
- `committee`: procurement or committee buyer: RFP/tender, steering/brand committee, vendor onboarding
- `on-site`: on-site or local presence required, US-only, security clearance
- `growth-ask`: expects design to drive leads/SEO/ads (a growth-agency ask)
- `cost-shopper`: cost-shopper language ("cheapest", "tight budget")
- `locked-design`: applying an already-locked brand system, or a development job building from finished designs

## Decision rules

The decision depends on the service and the money only:

- **qualified** — the core ask is a service we sell and the money rule holds (at least $50/hr and more than
  $3,500 total), or it is an entry project (at least $50/hr, $1,000–$3,500, high growth potential).
- **maybe** — the core ask is a service we sell but the money can't be judged (no budget stated, or the
  scope too vague to estimate the hours), or a small job with medium growth potential.
- **rejected** — the core ask is not a service we sell, or the money rule clearly fails: under $50/hr, or
  $3,500 or less without high growth potential, or no cash pay.

When unsure between two decisions, pick the more conservative one (maybe over qualified).
