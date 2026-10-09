import type { IcpDecision, IcpTier, IcpVerdict, Job } from "../types.ts";
import { icpCriteria as C } from "./criteria.ts";

/**
 * Deterministic ICP classifier implementing icp-brief.md with regexes.
 *
 * Pipeline:
 *  1. Service fit   — is the core ask (title + Contra roles) something Pixelup sells?
 *  2. Deal-breakers — any hit in title/description rejects outright.
 *  3. Budget        — below floor rejects; below entry price caps at "maybe".
 *  4. Signals       — weighted client-fit evidence (AI-native, B2B, funding, upmarket, triggers).
 *  5. Decision      — qualified needs score ≥ qualifiedMinScore and no caps; tier from the rings.
 */

type Rule = { id: string; label: string; re: RegExp };
type Signal = Rule & { weight: number };

// ── 1. Services ─────────────────────────────────────────────────────────────

const SERVICES: Rule[] = [
  {
    id: "brand",
    label: "brand identity",
    re: /\b(re-?brand(ing|ed)?|brand(ing)?\s+(identity|design|designer|strategy|strategist|system|guidelines?|book|refresh|overhaul|kit|platform|development|positioning)|visual identity|identity (design|system)|corporate identity|branding)\b/i,
  },
  {
    id: "website",
    label: "website",
    re: /\b(web ?site|landing ?pages?|marketing (site|website|page)|home ?page|web)\s+(design(er|s)?|re-?design|revamp|refresh|overhaul|rebuild|build|development)\b|\b(re-?design|revamp|refresh|overhaul|rebuild|design|build|create)\s+(of\s+)?(our|a|the|my|an)?\s*(new\s+)?(web ?site|landing ?pages?|marketing site|home ?page)\b|\bwebflow\b|\bframer\b(?!\s*motion)|\blanding ?pages?\b/i,
  },
  {
    id: "product",
    label: "product / UI-UX design",
    re: /\b(product design(er)?|UI ?\/ ?UX|UX ?\/ ?UI|UI ?(&|and) ?UX|UX ?(&|and) ?UI|UI design(er)?|UX design(er)?|UX|UI|user (interface|experience)|dashboard design|app design|(saas|web|mobile|ai) app (ui|ux|design)|interaction design(er)?|product ui)\b/i,
  },
  { id: "design-system", label: "design system", re: /\b(design systems?|component librar(y|ies)|UI kit|style ?guide)\b/i },
  {
    id: "deck",
    label: "pitch / sales deck",
    re: /\b((pitch|investor|sales|fundraising|board|series [AB]) deck|presentation design(er)?|deck design(er)?)\b/i,
  },
  {
    id: "positioning",
    label: "positioning & messaging",
    re: /\b(positioning|messaging (framework|strategy|architecture|house)|brand (narrative|story|storytelling))\b/i,
  },
  { id: "creative-direction", label: "creative direction", re: /\b(creative|art) direct(or|ion)\b/i },
];

/** Contra role names that map to our services. */
const SERVICE_ROLES =
  /\b(brand(ing)? (designer|strategist|identity designer|consultant)|brand identity|web(site)? designer|(webflow|framer) (developer|designer|expert)|product designer|UI designer|UX designer|UI ?\/ ?UX designer|UX ?\/ ?UI designer|visual designer|presentation designer|pitch deck designer|creative director|art director|design systems? designer|landing page designer|interaction designer|digital designer)\b/i;

/** Services we sell only as part of a bigger scope — alone they cap at "maybe". */
const WEAK_SERVICES: Rule[] = [
  { id: "logo-only", label: "logo-only ask (cost-shopper risk)", re: /\blogo( designer| design)?\b/i },
  { id: "graphic-only", label: "generic graphic-design ask", re: /\bgraphic design(er)?\b/i },
];

/** Core asks we don't sell. Only consulted when no service matched the title/roles. */
const OUT_OF_SCOPE =
  /\b(video|videographer|film|editor|editing|animat(or|ion|ions|ed)|motion (graphics?|design(er)?)|3D|CGI|renderings?|illustrat(or|ion|ions)|photograph(er|y)|copywrit(er|ing)|content (writ(er|ing)|creat(or|ion))|ghostwrit(er|ing)|blog(ger|ging)?|SEO|SEM|PPC|paid (ads|social|media)|media buy(er|ing)|(google|facebook|meta|linkedin|tiktok) ads|performance marketing|growth market(er|ing)|demand gen(eration)?|lead gen(eration)?|email marketing|social media|community manag(er|ement)|influencer|UGC|podcast|voice[- ]?over|translat(or|ion)|transcri(ber|ption)|data entry|virtual assistant|customer (success|support|service)|sales|business development|account (executive|manager)|appointment setter|cold call(er|ing)|recruit(er|ing)|bookkeep(er|ing)|accountant|accounting|paralegal|lawyer|(back[- ]?end|full[- ]?stack|front[- ]?end|software|mobile|iOS|android|devops|data|ML|AI|blockchain|smart contract|python|java(script)?|react|node(\.js)?|shopify|wordpress|unity|game) (developer|engineer|dev)|engineer(ing)?|developer advocate|QA|tester|data (scientist|analyst)|machine learning|marketing manager|marketer|product manager|project manager)\b/i;

/** In a title that also names a service, these mean the ask is probably production/implementation, not design. */
const MIXED_TITLE = /\b(video|film|animat(or|ion|ions)|motion|3D|illustrat(or|ion)|photograph(er|y)|copywrit(er|ing)|SEO|ads|developer|engineer|implementation)\b/i;

/** A design ask stated in the description when the title is vague ("Help needed", "Project for X"). */
const DESCRIPTION_ASK =
  /\b(looking for|need|needs|seeking|hire|hiring|want)\b[^.\n]{0,60}\b(brand(ing)?|re-?brand|visual identity|web ?site|landing ?page|web design(er)?|product design(er)?|UI ?\/ ?UX|UX ?\/ ?UI|UI|UX|design system|pitch deck)\b/i;

// ── 2. Deal-breakers (doc §4 anti-market) ───────────────────────────────────

const HARD_REJECTS: Rule[] = [
  {
    id: "crypto",
    label: "crypto / web3",
    re: /\b(crypto(currency|currencies)?|web ?3|NFTs?|DeFi|memecoins?|meme ?coins?|blockchain|on-?chain|tokenomics|DAO|airdrop|presale|token (launch|sale))\b/i,
  },
  {
    id: "pre-pmf",
    label: "pre-PMF / unfunded / equity-only",
    re: /\b(pre-?seed|idea[- ]stage|(just|only) (an|the) idea|startup idea|(my|an) app idea|validat(e|ing) (my|our|the) idea|unfunded|no funding( yet)?|haven'?t raised|not (yet )?funded|pre-?product|pre-?revenue|pre-?PMF|mid-?pivot|(technical )?co-?founder wanted|looking for (a )?(technical )?co-?founder|equity[- ]only|sweat equity|(paid )?(in|for) equity|revenue[- ]share|rev[- ]share|unpaid|volunteer)\b/i,
  },
  {
    id: "cost-shopper",
    label: "cost-shopper language",
    re: /\b((tight|limited|low|small|modest|shoestring|minimal) budget|lowest (price|rate|bid|quote)|cheap(est)?|as cheap as|budget[- ]friendly|on a budget|low[- ]cost (designer|logo|website))\b/i,
  },
  {
    id: "committee",
    label: "procurement / committee buyer",
    re: /\b(steering committee|brand committee|design committee|RFP|RFQ|requests? for (proposals?|quotations?)|vendor (onboarding|registration|qualification)|tender (process|document)|(our|the) procurement (process|department)|stakeholder (committee|sign-?off)|(multiple|several) stakeholders? (approval|sign-?off)|board approval)\b/i,
  },
  {
    id: "on-site",
    label: "on-site / US-domicile required",
    re: /\b(on-?site (only|required|work|role|position|presence)|in-?office (only|required|role|position)|in[- ]person (only|required|work|role)|(must|need to|required to) (be|reside|live|work)( located| based)? in (the )?(US|USA|U\.S\.|United States|UK|Europe|EU|Canada)|(US|U\.S\.)[- ](citizens?|persons?|residents?) only|security clearance|must be (US|UK|EU)[- ]based|(US|UK|EU)[- ]based only|local (candidates|freelancers) only|relocation required|hybrid (role|position))\b/i,
  },
  {
    id: "employment",
    label: "full-time / in-house employment",
    re: /\b(full[- ]time (employee|employment|position|role|hire|job)|permanent (position|role|hire)|W-?2|salaried|in-?house (designer|position|role|hire)|employee benefits|health insurance|401k)\b/i,
  },
  {
    id: "execution-only",
    label: "design already done — implementation only (pixel-pusher ask)",
    re: /\b((designs?|mock-?ups?|figma( files?)?|wireframes?|layouts?) (is|are) (already )?(complete|completed|done|finished|final(ized)?|ready|provided|locked|approved)|design (and content )?(is|are) (complete|done|finished|final|ready)|(convert|turn|translate|implement|build|code|develop) (our |the |these |existing |an existing |provided |ready |approved )?(figma|xd|sketch|psd|adobe xd|designs|design files|mock-?ups?) (files? )?(in)?to|figma[- ]to[- ](webflow|framer|code|html|react|wordpress)|implementation of (our|the|existing) (figma|designs?)|we (already )?have (the |our |all )?(designs|figma files|mock-?ups)( ready| done| complete)?|(just|only) need (someone|a developer|help) to (build|implement|develop|code))\b/i,
  },
  {
    id: "agency",
    label: "agency / white-label work",
    re: /\b(white[- ]?label(ed)?|sub-?contract(or|ing)?|(for|on behalf of) (one of )?our clients?|our client'?s (brand|website|project|app)|agency (partner|overflow|capacity)|we'?re (a|an) [\w -]{0,30}agency|we are (a|an) [\w -]{0,30}agency)\b/i,
  },
];

const B2C =
  /\b(B2C|D2C|DTC|direct[- ]to[- ]consumer|e-?commerce (store|brand|site|website|shop)|online (store|shop)|shopify (store|theme|site)|etsy|amazon (listing|store|seller)|dropshipping|consumer (app|brand|product)|restaurant|caf[eé]|coffee shop|bakery|salon|real estate (agent|agency|listing)|realtor|wedding|personal (brand(ing)?|website)|portfolio website|my (book|novel|podcast|youtube|channel|music|band|album)|influencer|life coach|(coach|coaching) (business|brand|website)|fitness (brand|app|coach|studio)|gym|yoga|clothing (brand|line)|fashion brand|apparel|streetwear|skincare|cosmetics|beauty brand|jewel(le)?ry|candles?|pet (brand|food|products)|church|ministry|dating app|mobile game|esports|(product |physical )?packaging|cartons?|sachets?|vitamins?|supplements|supplement (brand|startup|company|line)|CPG|FMCG|consumer goods|beverages?|(food|drink|tea|coffee|wine|beer|spirits|snack) brand|merch(andise)?)\b/i;

// ── 4. Weighted signals (doc §2 firmographics, §2 signal stack, §5 inciting events) ──

const AI_NATIVE: Signal = {
  id: "ai-native",
  label: "AI-native product",
  weight: 3,
  re: /\b(AI[- ](native|powered|first|platform|startup|company|agents?|product|infrastructure|infra|copilot|assistant|models?|lab|SaaS)|generative AI|gen ?AI|LLMs?|large language models?|foundation models?|agentic|autonomous agents?|machine learning|ML (platform|infrastructure|ops)|MLOps|RAG|copilot|inference|vector (database|search)|computer vision|voice AI)\b/i,
};

const B2B: Signal = {
  id: "b2b-software",
  label: "B2B software / SaaS",
  weight: 2,
  re: /\b(B2B|SaaS|enterprise (software|platform|customers|clients|buyers|teams|grade)|developer (tools?|platform|experience)|dev ?tools|devtools|APIs?|infrastructure|platform for (teams|businesses|companies|enterprises|developers)|fintech|health ?tech|legal ?tech|insurtech|regtech|proptech|govtech|cyber ?security|security (platform|company|startup)|compliance (platform|software|automation)|data (platform|infrastructure|pipelines?|warehouse)|analytics platform|observability|workflow automation|vertical (SaaS|AI))\b/i,
};

const STAGE_BULLSEYE: Signal = {
  id: "series-a-b",
  label: "Series A/B",
  weight: 3,
  re: /\bseries [AB]\b/i,
};

const STAGE_ACCEPTABLE: Signal = {
  id: "funded",
  label: "venture-funded (seed/Series C+/backed)",
  weight: 2,
  re: /\b(series [C-F]|seed[- ](round|stage|funded|funding)|post-?seed|late[- ]seed|raised (a|our) seed|venture[- ]backed|VC[- ]backed|backed by|funded by)\b/i,
};

const TOP_BACKER: Signal = {
  id: "top-backer",
  label: "YC / top-tier investor",
  weight: 1,
  re: /\b(YC|Y ?Combinator|a16z|Andreessen|Sequoia|Accel|Benchmark|Lightspeed|Index Ventures|General Catalyst|Greylock|Kleiner|Founders Fund|Khosla|Insight Partners|Bessemer|Redpoint|Felicis|First Round|Thrive Capital|Coatue|Tiger Global|Elad Gil|SV Angel)\b/,
};

const UPMARKET: Signal = {
  id: "upmarket",
  label: "going upmarket / needs enterprise credibility",
  weight: 2,
  re: /\b(enterprise[- ](ready|grade|buyers|customers|clients|deals|sales|motion|market|prospects)|(move|moving|going|push(ing)?) upmarket|upmarket|Fortune 500|F500|SOC ?2|ISO 27001|security reviews?|look (more )?(credible|established|legit(imate)?|mature|serious|enterprise|trustworthy)|credibility|(build|establish|earn) trust|contact sales|first (AE|account executive|sales hire)|sales[- ]led)\b/i,
};

const TRIGGERS: Signal[] = [
  { id: "trigger-rebrand", label: "rebrand / refresh underway", weight: 1, re: /(?<!\bnot (a |an )?(full |complete |total )?)\b(re-?brand(ing)?|brand refresh|refresh (our|the) brand|new brand)\b/i },
  { id: "trigger-raise", label: "just raised", weight: 1, re: /\b((just|recently) (raised|closed)|new funding|freshly (funded|raised)|post-?raise|announc(e|ing) (our|the) (round|raise|funding))\b/i },
  { id: "trigger-deadline", label: "launch / event deadline", weight: 1, re: /\b(launch(ing)?|go-to-market|GTM|conference|summit|demo day|deadline|by (Q[1-4]|end of))\b/i },
  { id: "trigger-perception", label: "current brand looks generic/outdated", weight: 1, re: /\b(outgrown|outdated|dated|looks? (generic|template[d]?|cheap|amateur|like every)|template[- ](built|based|look)|doesn'?t (reflect|represent) (who we are|us|our)|competitors?)\b/i },
];

const EXTRA_SIGNALS: Signal[] = [
  { id: "positioning", label: "values positioning/narrative", weight: 1, re: /\b(positioning|messaging|narrative|point of view|category|differentiat(e|ion)|stand out)\b/i },
  { id: "systems", label: "wants systems / ongoing partnership", weight: 1, re: /\b(design systems?|retainer|ongoing|long[- ]term|monthly)\b/i },
  { id: "founder-led", label: "founder-led decision", weight: 1, re: /\b(I'?m (the )?(co-?)?founder|our (co-?)?founders?|founder[- ]led|(co-?)?founder|CEO)\b/i },
];

const GROWTH_ASK: Signal = {
  id: "growth-ask",
  label: "expects design to drive leads/SEO/ads",
  weight: -2,
  re: /\b((drive|generate|increase|boost) (more )?(leads|MQLs|SQLs|traffic|organic traffic)|SEO[- ](optimi[sz]ed|ranking|strategy)|rank (higher|on google)|guaranteed? (results|leads|ROI))\b/i,
};

const LOCKED_BRAND: Signal = {
  id: "locked-brand",
  label: "brand/strategy already locked — execution against an existing system",
  weight: -2,
  re: /\b((apply|follow|use|work within|stick to) (our|the) existing (brand|design) (system|guidelines|identity)|(logo|brand|direction|foundation)[\w ,]{0,30} (is|are) already (established|done|set|defined|locked))\b/i,
};

const LOW_BUDGET_MARKET: Signal = {
  id: "low-budget-market",
  label: "India / INR budget (case-by-case)",
  weight: -2,
  re: /₹|\bINR\b|\bRs\.?\s?\d|\blakhs?\b|\bcrores?\b/i,
};

// ── helpers ──────────────────────────────────────────────────────────────────

const UNIT: Record<string, number> = { k: 0.001, m: 1, mm: 1, million: 1, b: 1000, bn: 1000, billion: 1000 };

/** Amounts raised mentioned in the text, in USD millions. */
export function raisedMillions(text: string): number[] {
  const found = new Map<number, number>(); // amount's position → value (both patterns can match one amount)
  const patterns = [
    /\b(?:raised|raising|closed|secured)\s+(?:a |an |our |over |about |~|nearly |almost )?(?:US)?\$\s?(\d+(?:\.\d+)?)\s?(k|mm|m|million|bn|b|billion)\b/gi,
    /(?:US)?\$\s?(\d+(?:\.\d+)?)\s?(k|mm|m|million|bn|b|billion)\b\s+(?:seed|pre-seed|series [a-f]|round|raise|in funding|funding|in venture)/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const at = m.index + m[0].indexOf(m[1]);
      found.set(at, Number(m[1]) * (UNIT[m[2].toLowerCase()] ?? 1));
    }
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** Team size mentioned in the text ("25 employees", "team of 40"). */
export function teamSize(text: string): number | null {
  const m =
    text.match(/\b(\d{1,5})\+?\s*(?:employees|people|person team|-person team|team members|FTEs?|staff)\b/i) ??
    text.match(/\bteam of (\d{1,5})\b/i);
  return m ? Number(m[1]) : null;
}

type BudgetStatus = "below-floor" | "below-target" | "ok" | "premium" | "unknown";

export function budgetStatus(job: Job): { status: BudgetStatus; label: string } {
  const b = job.budget;
  const amount = b?.feeMax ?? b?.feeMin;
  if (!b || amount == null || b.type === "UNKNOWN") return { status: "unknown", label: "budget not stated" };
  const t = C.budget[b.type];
  const unit = { FIXED: "", HOURLY: "/hr", WEEKLY: "/wk", MONTHLY: "/mo" }[b.type];
  const shown = `$${amount.toLocaleString("en-US")}${unit}`;
  if (amount < t.floor) return { status: "below-floor", label: `budget ${shown} is below the $${t.floor.toLocaleString("en-US")}${unit} floor` };
  if (amount < t.target) return { status: "below-target", label: `budget ${shown} is below the $${t.target.toLocaleString("en-US")}${unit} entry price` };
  if (amount >= t.premium) return { status: "premium", label: `premium budget ${shown}` };
  return { status: "ok", label: `budget ${shown} fits` };
}

function countryIn(country: string | null, list: string[]): boolean {
  return !!country && list.some((c) => c.toLowerCase() === country.trim().toLowerCase());
}

function clean(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, " ");
}

// ── classifier ───────────────────────────────────────────────────────────────

export interface RegexOptions {
  /** Don't cap at "maybe" just because the description hasn't been fetched (used by prescreen). */
  ignoreMissingDescription?: boolean;
}

export function classifyRegex(job: Job, opts: RegexOptions = {}): IcpVerdict {
  const title = clean(job.title);
  const roles = clean(job.roles.join(" | "));
  const head = `${title}\n${roles}`;
  const desc = clean(job.description ?? "");
  const body = `${title}\n${desc}`; // deal-breakers & signals: what the client wrote
  const all = `${head}\n${job.tools.join(" ")}\n${desc}`;

  const rejects: string[] = [];
  const caps: string[] = [];
  const positives: string[] = [];
  const negatives: string[] = [];
  const signals: string[] = [];
  let score = 0;

  const add = (s: Signal | { id: string; label: string; weight: number }) => {
    score += s.weight;
    signals.push(`${s.weight >= 0 ? "+" : ""}${s.weight} ${s.id}`);
    (s.weight >= 0 ? positives : negatives).push(s.label);
  };

  // 1. Service fit
  const services = SERVICES.filter((r) => r.re.test(head));
  if (SERVICE_ROLES.test(roles) && !services.length) services.push({ id: "service-role", label: roles, re: /$^/ });
  const weak = WEAK_SERVICES.filter((r) => r.re.test(head));
  let serviceLabel: string;

  if (services.length) {
    serviceLabel = services.map((s) => s.label).join(" + ");
    signals.push(...services.map((s) => `service:${s.id}`));
    if (MIXED_TITLE.test(title)) caps.push(`title mixes design with production/implementation work ("${title}")`);
    if (services.length >= 2) add({ id: "multi-service", label: "multi-service scope", weight: 1 });
  } else if (weak.length && !OUT_OF_SCOPE.test(head)) {
    serviceLabel = weak.map((w) => w.label).join(" + ");
    signals.push(...weak.map((w) => `service:${w.id}`));
    caps.push(serviceLabel);
    if (weak.some((w) => w.id === "logo-only")) add({ id: "logo-only", label: "logo-only ask", weight: -2 });
  } else if (OUT_OF_SCOPE.test(head)) {
    const what = head.match(OUT_OF_SCOPE)![0];
    return verdict("rejected", null, score, [`not a service we sell — core ask is "${what}" (${title})`], [...signals, "reject:out-of-scope"]);
  } else if (DESCRIPTION_ASK.test(desc)) {
    serviceLabel = "design ask in description";
    signals.push("service:description");
    caps.push("design ask found only in the description, not the title/roles");
  } else {
    return verdict("rejected", null, score, [`no brand / website / product-design ask found (${title})`], [...signals, "reject:no-service"]);
  }

  // 2. Deal-breakers
  for (const r of HARD_REJECTS) {
    const m = body.match(r.re);
    if (m) {
      rejects.push(`${r.label} ("${m[0]}")`);
      signals.push(`reject:${r.id}`);
    }
  }

  const isB2B = B2B.re.test(all);
  const isAI = AI_NATIVE.re.test(all);
  const b2c = body.match(B2C);
  if (b2c) {
    if (isB2B || isAI) {
      caps.push(`consumer-brand language ("${b2c[0]}") alongside B2B signals`);
      add({ id: "b2c-mixed", label: `consumer-brand language ("${b2c[0]}")`, weight: -3 });
    } else {
      rejects.push(`B2C / consumer client ("${b2c[0]}")`);
      signals.push("reject:b2c");
    }
  }

  const raised = raisedMillions(body);
  const maxRaised = raised.length ? Math.max(...raised) : null;
  if (maxRaised != null && maxRaised < C.raised.excludeBelow) {
    rejects.push(`raised only ~$${maxRaised}M (< $${C.raised.excludeBelow}M)`);
    signals.push("reject:raised-under-2m");
  }
  const team = teamSize(body);
  if (team != null && team > 500) {
    rejects.push(`team of ${team} (> 500 — committee-buyer territory)`);
    signals.push("reject:team-over-500");
  }

  // 3. Budget
  const budget = budgetStatus(job);
  if (budget.status === "below-floor") {
    rejects.push(budget.label);
    signals.push("reject:budget-floor");
  }

  if (rejects.length) return verdict("rejected", null, score, rejects, signals);

  if (budget.status === "below-target") caps.push(budget.label);
  else if (budget.status === "unknown") caps.push(budget.label);
  else add({ id: `budget-${budget.status}`, label: budget.label, weight: budget.status === "premium" ? 3 : 2 });

  // 4. Client-fit signals
  if (isAI) add(AI_NATIVE);
  if (isB2B) add(B2B);
  const bullseyeStage = STAGE_BULLSEYE.re.test(body);
  if (bullseyeStage) add(STAGE_BULLSEYE);
  else if (STAGE_ACCEPTABLE.re.test(body)) add(STAGE_ACCEPTABLE);
  if (TOP_BACKER.re.test(body)) add(TOP_BACKER);
  const raisedBullseye = maxRaised != null && maxRaised >= C.raised.bullseyeMin && maxRaised <= C.raised.bullseyeMax;
  if (raisedBullseye) add({ id: "raised-bullseye", label: `raised ~$${maxRaised}M`, weight: 1 });
  else if (maxRaised != null && maxRaised > C.raised.acceptableMax) add({ id: "raised-late", label: `raised ~$${maxRaised}M (late stage)`, weight: -1 });
  if (team != null && team >= 10 && team <= 80) add({ id: "team-bullseye", label: `team of ${team}`, weight: 1 });
  else if (team != null && team < 5) add({ id: "team-tiny", label: `team of ${team}`, weight: -1 });
  const upmarket = UPMARKET.re.test(body);
  if (upmarket) add(UPMARKET);
  let triggers = 0;
  for (const s of TRIGGERS) {
    if (triggers < 3 && s.re.test(body)) {
      add(s);
      triggers++;
    }
  }
  for (const s of EXTRA_SIGNALS) if (s.re.test(body)) add(s);
  if (GROWTH_ASK.re.test(body)) add(GROWTH_ASK);
  if (LOCKED_BRAND.re.test(body)) add(LOCKED_BRAND);
  if (LOW_BUDGET_MARKET.re.test(body) || countryIn(job.country, C.lowBudgetCountries)) add(LOW_BUDGET_MARKET);
  else if (countryIn(job.country, C.premiumCountries)) add({ id: "premium-market", label: `client in ${job.country}`, weight: 1 });
  if (job.hiringAsIndividual) add({ id: "individual", label: "posted by a private individual", weight: -1 });

  const funded = bullseyeStage || STAGE_ACCEPTABLE.re.test(body) || raisedBullseye || TOP_BACKER.re.test(body);
  if (!isB2B && !isAI && !funded) caps.push("no evidence the client is a funded B2B software company");
  if (!job.description && !opts.ignoreMissingDescription) caps.push("description not fetched — judged on title/roles only");

  // 5. Decision
  if (score < C.maybeMinScore) {
    return verdict("rejected", null, score, [`weak fit (score ${score}): ${negatives.join("; ")}`], [...signals, "reject:low-score"]);
  }
  const tier: IcpTier =
    isAI && isB2B && (bullseyeStage || upmarket || raisedBullseye) ? "carol" : isB2B || funded ? "diana" : "eddie";
  const qualified = !caps.length && score >= C.qualifiedMinScore;
  const reasons = [
    `${serviceLabel} ask`,
    ...positives,
    ...negatives.map((n) => `− ${n}`),
    ...caps.map((c) => `⚠ ${c}`),
    ...(!qualified && !caps.length ? [`⚠ score ${score} < ${C.qualifiedMinScore} needed to qualify`] : []),
  ];
  return verdict(qualified ? "qualified" : "maybe", tier, score, reasons, signals);
}

function verdict(decision: IcpDecision, tier: IcpTier | null, score: number, reasons: string[], signals: string[]): IcpVerdict {
  return { decision, tier, score, reasons, signals, classifier: "regex" };
}

/**
 * Cheap title/roles/budget-only screen used before fetching descriptions via the MCP,
 * so we only spend get_job_by_slug calls on jobs that could still qualify.
 */
export function prescreen(job: Job): { fetchDetail: boolean; reason: string } {
  const v = classifyRegex({ ...job, description: null }, { ignoreMissingDescription: true });
  return { fetchDetail: v.decision !== "rejected", reason: v.reasons[0] ?? "" };
}
