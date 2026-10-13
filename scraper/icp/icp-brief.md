# Pixelup Labs — ICP brief for qualifying Contra jobs

Source: "Pixelup Labs — Positioning & ICP Engine" (July 2026). This is the rubric the LLM classifier
receives verbatim for every job on the board, and the spec the regex classifier (`regex.ts`) implements
(the free local mode, and the stand-in when an LLM call fails). Edit both together.

## Who we are

Pixelup Labs is the **enterprise-readiness design partner for funded B2B (mostly AI-native) startups**.
We rebuild a startup's brand, website and product design around the opinion the founder holds about
their market, so enterprise buyers stop hesitating. Founder-to-founder, senior team, ships in weeks
(2-week brand sprints, ~3-week sites, ~5 weeks for brand + site). Mainline sprints are $25–30k; the
smallest project we take is **$10,000**; retainers start at $4k/month. Bangalore-based, SF-calibrated.

## Services that qualify a job (at least one must be the core of the job)

- Brand identity / rebrand / visual identity / brand strategy, positioning & messaging
- Website / marketing site / landing page design or redesign (incl. Webflow or Framer builds we design)
- Product design: UI/UX for a SaaS or AI product, dashboards, web apps
- Design systems, component libraries, ongoing design retainers
- Pitch, investor or sales decks (as part of brand work)
- Custom development: Next.js / React websites and web apps, front-end builds, custom-coded sites

Not our service (reject when it is the core of the job): video editing, animation-only, motion-only,
3D, illustration-only, photography, copywriting/content-only, SEO, ads/performance marketing, lead
generation, social media management, sales/BD/customer success, engineering outside Next.js/React
(backend-only, mobile incl. React Native/Flutter, data/ML, DevOps), Shopify/WordPress/Wix/Squarespace
builds, virtual assistance.

## Client fit (the rings)

| | Bullseye — "Carol" | Acceptable — "Diana/Eddie" | Exclude |
|---|---|---|---|
| Category | AI-native B2B software (infra, devtools, vertical AI, applied AI) | Any B2B software/SaaS; fintech-, healthcare-, legal-serving tech | B2C, agencies, services, crypto/web3, pre-product |
| Stage | Series A – Series B (incl. fast seed→A breakouts) | Late seed with $3M+ raised; Series C | Pre-seed, unraised, mid-pivot |
| Raised | $5M–$60M | $3M–$150M | < $2M |
| Team | 10–80 | 5–200 | > 500 |
| Geo | SF Bay Area | US, UK, EU, AUS, SG, premium remote | Primarily-India / low-budget markets (case-by-case) |
| Motion | PLG→sales-led; "Contact sales" tier; first AE/SDR hires | Enterprise-only sales | Pure self-serve, no enterprise ambition |
| Competition | Saturated or legacy-incumbent-dominated ("modern alternative to X") | Category creators | Monopolies with no perception pressure |

- **carol** = AI-native B2B + (Series A/B or a visible going-upmarket/enterprise signal).
- **diana** = any funded B2B software startup raising or moving upmarket.
- **eddie** = any B2B company that wants to look serious and can pay.

## Positive signals (raise confidence)

- Funding: Series A/B, a named top-tier investor or YC, "just raised", amount raised $5M–$60M
- Going upmarket: enterprise buyers/deals, Fortune 500, SOC 2, security review, "contact sales", first AE hire, needs to look credible/established/trustworthy
- Inciting events: rebrand, launch, conference/deadline, competitor out-branding them, site looks generic/template/outdated, outgrown current brand
- Opinionated founder; positioning/messaging/narrative work welcome; founder-led decision (no committee)
- Wants systems: design system, retainer, long-term partnership
- Testing the waters: a paid trial or small first project with more to follow ("first phase", "ongoing", "if this goes well")
- Budget at or above our $10,000 minimum project (≥ $4k/month retainer for 3+ months)

## Deal-breakers (reject)

- Pre-PMF / idea stage / pre-seed / unfunded / mid-pivot; equity-only, rev-share or unpaid work
- Cost-shoppers: "tight/low budget", "cheapest", "logo for $500"; a budget far below what the work asked for is worth.
  A small budget alone is not cost-shopping when the client is strong and the first project is simply small (see Entry projects).
- Procurement-driven or committee buyers: RFP/tender, steering/brand committee, vendor onboarding
- On-site or US-domicile required, security clearance, local-only
- Buyers expecting design to drive leads/SEO/ads ("make design drive our MQLs") — a growth-agency ask
- Pixel-pushers: design already complete/locked, "convert our Figma to Webflow/code", "just implement" (applying an already-locked brand system is a strong negative).
  Exception: for a Next.js/React development job, building from finished designs is a minor negative ("maybe"), not a deal-breaker.
- Agencies or white-label/subcontract work for someone else's client
- B2C/consumer brands (e-commerce, DTC, CPG/packaging, supplements, food & drink, restaurants, coaches, personal brands, real estate, fashion…)
- Crypto/web3/NFT/DeFi

## Project size (minimum $10,000)

We take on sprints, not small tasks. A job is worth it only if it is (or clearly can become) one of:

- **Brand sprint**: identity / rebrand / brand system, ~2 weeks
- **Website sprint**: a full marketing site design and build (not a single page or a few edits), ~3 weeks
- **Product design + development sprint**: designing and/or building a meaningful part of a SaaS or AI
  product (a set of flows, a dashboard, an MVP, a design system), not 2–3 screens
- or a combination of these

Read the whole post and judge how big the work actually is, then estimate the **total project value in
USD**: a fixed budget as stated; an hourly/weekly rate × the hours or duration the post states, or else
the hours the described scope realistically needs; a monthly retainer × its stated or likely length.
A high rate does not make a small scope worth it: $100/hr to design 2–3 screens is a ~$1–2k job.
If the stated budget and the described scope disagree, go with what the scope realistically pays.

Below $10,000 is too small for a sprint (a logo, one landing page, a few screens, small fixes, a handful
of hours). Judge whether it is an entry project instead.

## Entry projects (small now, could grow)

Some clients test the waters with a small first project before they hand over the bigger work: we have had
a client start with a logo and grow into a full engagement. So don't reject a job for its size alone; judge
where it could lead and rate `growth_potential`:

- **high**: a strong-fit client (a funded or clearly well-resourced B2B software company, ideally AI-native)
  whose small ask is the first piece of work we sell: a logo or landing page for a funded startup with no
  real brand or site yet, a brand refresh that will need a site to match, a few screens of a product that is
  clearly growing, or the post says more work follows ("first phase", "trial project", "ongoing",
  "long-term", "if this goes well").
- **medium**: decent client fit and a plausible but unstated path to a sprint.
- **low**: weak or unknown client fit, or a self-contained one-off (a logo for a side project, small fixes,
  a single asset).
- **none**: a deal-breaker applies or the work isn't something we sell.

Write `growth_path` as the likely next steps (e.g. "logo → brand sprint → marketing site"), or leave it
empty. Rate it for sprint-sized jobs too: there it says whether the work could become a retainer or more
sprints. An entry project must still pay at least $1,000 for the first piece.

## Full-time roles

A full-time or in-house role is **not** a deal-breaker. Judge it like any other job (service, client fit,
size; value it as the pay over ~6 months unless the post says otherwise) and set `full_time` to true.
We won't take the seat; we'll reach out to the company on a different platform and pitch a sprint instead.

## Decision rules

- **qualified** — the core ask is one of our services, the client is (or very likely is) a funded B2B
  software company, no deal-breaker applies, and either the estimated project value is at least $10,000
  (a sprint, or a combination) or it is an entry project: high growth potential and at least $1,000.
- **maybe** — service fits but evidence of client fit is thin, the size is unclear but could plausibly
  reach $10,000, a small job with medium growth potential, a minor negative applies (e.g. India-based, a
  development job building from finished designs), or the description is missing.
- **rejected** — any deal-breaker, the core ask is not a service we sell, or the work is small with low
  or no growth potential.

When unsure between two decisions, pick the more conservative one (maybe over qualified).
