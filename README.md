# Contra jobs scraper

Pulls the Contra job feed through Contra's official MCP server (read-only tools only:
`whoami`, `list_job_feed`, `get_job_by_slug`), has Claude judge every job against the Pixelup ICP
(`scraper/icp/`), posts the ones worth acting on to Slack, sends full-time roles to a Google Sheet as
outreach leads, and shows the leads in a small Next.js dashboard where the team tracks each one's stage.

## Rules for using Contra

Contra's terms only allow automated access through Contra's own software, and bar storing other
users' personal information. So:

- **Contra MCP only.** Never load contra.com pages any other way (no crawling, browser automation,
  WebFetch or curl). If the MCP fails, the run stops.
- **Read-only.** `scraper/mcp-client.ts` refuses every tool except `whoami`, `list_job_feed` and
  `get_job_by_slug`. Don't add applying, bookmarking, dismissing or messaging.
- **No personal information stored.** Poster names are never read; company names are dropped for
  private individuals; cached descriptions have emails and phone numbers removed, live outside git
  (`data/details/`, kept between runs by the Actions cache) and are never written to run output.
- **Leads come from the public web, not Contra.** For full-time roles the workflow looks up the
  *company* (never the poster) with Claude's web search, with contra.com blocked. The founders it finds
  (names, public LinkedIn/X) go only to the lead sheet: `data/leads/` is gitignored and never committed.
- **The login token can act on the whole Contra account.** Keep this repo private and limit who has
  write access.

`scraper/contra.test.ts` checks these rules.

## Automatic runs (GitHub Actions)

`.github/workflows/scrape.yml` scrapes once a day from **11 AM San Francisco time**, plus on demand from
Actions → "Daily Contra scrape" → Run workflow. Each scrape commits `data/latest.json`,
`data/runs/`, `data/seen-ids.json` and `data/announced-ids.json`, then posts to Slack and the lead sheet.

GitHub starts this repo's scheduled runs hours late (4.5–7 hours in October 2026), so the workflow wakes
every hour and a quick `gate` job decides: the first wake-up at or after 11 AM SF scrapes, and its data
commit is tagged "(daily)"; later wake-ups that day find that commit and stop within seconds. If the
scrape fails, the next hour tries again. Manual runs always scrape and don't count as the daily one. The
hourly checks show up as short runs in the Actions tab.

Repository secrets (Settings → Secrets and variables → Actions):

| Secret | Source |
|---|---|
| `CONTRA_CLIENT_ID` | `.contra-auth.json` after `npm run contra:auth` |
| `CONTRA_REFRESH_TOKEN` | same |
| `ANTHROPIC_API_KEY` | Claude API key for the ICP classifier and the lead lookup |
| `GH_SECRETS_PAT` | Fine-grained PAT for this repo with **Secrets: Read and write**. Contra rotates the refresh token on every use; the workflow stores the new one with this. |
| `SLACK_WEBHOOK_URL` | Slack Workflow Builder webhook with Text variables `summary` and `jobs` |
| `LEADS_WEBHOOK_URL` | The lead sheet's Apps Script web app URL (see "Lead sheet"); the sheet step skips until it's set |
| `LEADS_WEBHOOK_TOKEN` | The `TOKEN` string set in that script |

Optional repository variable (same page, Variables tab): `LEADS_SHEET_URL`, the sheet's link, shown in Slack.

### Switching the Contra account (e.g. on another machine)

Needs Node 22.18+ (24 recommended) and a clone of this repo; no `npm install` needed for this step.

1. Run `npm run contra:auth`. Open the login link it prints in a **private/incognito window** and
   log in with the account to use; a browser already logged in to Contra connects that account
   without asking. The login must finish in a browser on the same computer.
2. Check the `Connected Contra account:` line shows the right person and "Contra Pro".
3. Copy both values from `.contra-auth.json` into the secrets above, then delete the file.
4. Don't run `npm run scrape:fetch` / `scrape:ci` locally with a token GitHub is using:
   each use rotates it and invalidates the other copy.

## How jobs are judged

The GitHub workflow uses `ICP_CLASSIFIER=anthropic`: Claude Sonnet 5.5 is the one evaluation layer.
It reads every job on the board, with its description, against `scraper/icp/icp-brief.md`. No rules
pre-filter it.

A job qualifies on three things only: the client is **B2B**, it's **work we sell** (brand, website,
product design, design systems, decks, Next.js/React), and it meets the **money rule**: at least **$50/hour** and more than
**$3,500** in total (rate × the hours the scope needs). A budget range counts at its middle ($2,500–$5,000
is $3,750). For fixed-price, weekly and monthly budgets the rate is the budget ÷ the hours Claude estimates
the scope needs; for hourly jobs it's the posted rate. Jobs of $3,500 or less are rejected.
Claude marks each client `b2b`, `b2c` or `unknown` (for agency or white-label work, the end client), and
the code rejects every B2C client; an unknown one can still qualify, flagged "B2B not confirmed". Beyond
that, who the client is doesn't change the decision: crypto, agency, on-site and similar concerns are
flagged in Slack and the app instead (a fixed list, `CONCERNS` in `scraper/icp/llm.ts`). Claude's
judgment is the hours the scope needs; the code works out the rate and total from the posted budget
(hourly: rate × hours; fixed: budget ÷ hours) and enforces the money rule on whatever Claude decides.

Claude also rates how likely each job is to grow (shown in the app), and the jobs that fit go into two lanes:

| Lane | What it is | Posted to Slack |
|---|---|---|
| project | meets the money rule | when qualified |
| outreach | a full-time role for work we sell: don't apply, reach out off Contra and pitch a project | when qualified or maybe, whatever the pay, with the company's links; founders go to the lead sheet |

Each job is posted once, the first run it fits (`data/announced-ids.json`), so an older job that a
change to the brief newly qualifies gets posted too. Each verdict is cached in `data/verdicts/`, so a
job is only sent to Claude once (again if the job or the brief changes; a brief change re-reads the
whole board, ~230 jobs, on the next run). If a Claude call fails, the regex rules (`regex.ts`) stand
in, capped at maybe, and the job is retried next run.

Other `ICP_CLASSIFIER` values: `regex` (the local default: free rules, an older and stricter version of
the brief, which also decide which descriptions to fetch), `none` (keep every job) and `openai`.
Housekeeping filters are in `scraper/filters.ts`; the money rule's numbers (`minHourlyUsd`,
`minProjectUsd`) are in `scraper/icp/criteria.ts`.

## Lead sheet

Full-time roles from companies (not private individuals) get a lookup: Claude with web search finds
the company's website, LinkedIn page and X account, and its founders. Each company is looked up once
(cached in `data/leads/`, kept between runs by the Actions cache, never committed). The company links
appear in Slack and the app; each lead becomes a row in the Google Sheet's "Leads" tab, with a blank
Status column for the team. Every run sends all current leads and the sheet skips ones it already has,
so connecting the sheet later, or a failed send, catches up on the next run.

To connect the sheet, once:

1. Open the Google Sheet → Extensions → Apps Script, and paste in `scripts/leads-sheet.gs`.
2. Set `TOKEN` in the script to a long random string (e.g. `openssl rand -hex 24`).
3. Deploy → New deployment → Web app, Execute as "Me", Who has access "Anyone". Copy the URL.
4. Add the repository secrets `LEADS_WEBHOOK_URL` (the URL) and `LEADS_WEBHOOK_TOKEN` (the string),
   and optionally the variable `LEADS_SHEET_URL`.

Until then the step logs how many leads it would have sent and skips. `LEAD_LOOKUP=anthropic` turns the
lookup on (the workflow sets it); `LEAD_MODEL` picks the model (default `claude-sonnet-5-5`).

## Lead dashboard

`npm run dev` → http://localhost:3000. It lists every job the AI layer qualified, from every scrape
(`data/runs/` and `data/latest.json`): qualified projects, and full-time roles that fit (the same rule as
Slack). A job keeps its newest verdict, so one a later run rejects drops out, unless it already has a stage.
Jobs that have left Contra's board stay, marked "off the board". `/latest` shows the latest scrape as before.

- **Stages:** New → Applied → Talking → Won / Lost / Passed, picked per lead. They're saved in
  `data/pipeline.json` (job id → stage, title, time), so git keeps the history.
- **Apply on Contra** opens the job post on contra.com to apply by hand. Full-time roles get
  **View post** instead, plus the company's links: those are for outreach off Contra, not applying.

Running locally, the dashboard reads `data/` and a stage change writes `data/pipeline.json`; commit and push it
to share.

**Hosted (Vercel).** A hosted copy has no `data/` folder, so set `DASHBOARD_GITHUB_TOKEN` (fine-grained PAT for
this repo, Contents: Read and write): it then reads `data/` from GitHub on every visit, so it always shows the
latest scrape without redeploying, and commits each stage change to `data/pipeline.json`
(`DASHBOARD_GITHUB_REPO` and `DASHBOARD_GITHUB_BRANCH` default to `PIXELUPLABS/contra-scrapper` and `main`).
It refuses to save stages until `DASHBOARD_PASSWORD` is set, which puts a password on every page (any
username). The scrape workflow rebases onto those commits before pushing its own. The Vercel project isn't
linked to this repo (Vercel blocks private-repo deploys from commit authors outside its team, such as the
Actions bot), so a code change needs a new deployment.

## Local use

- `npm run dev`: the lead dashboard at http://localhost:3000 (see "Lead dashboard")
- `/contra-scrape` in Claude Code: scrape through Claude Code's own Contra MCP login
- `SLACK_DRY_RUN=1 npm run notify` / `SHEET_DRY_RUN=1 npm run sheet`: print what would be posted
- `npm test`: ICP rule, lane, Contra-rules and lead dashboard tests
