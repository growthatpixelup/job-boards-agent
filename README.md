# Contra jobs scraper

Pulls the Contra job feed through Contra's official MCP server (read-only tools only:
`whoami`, `list_job_feed`, `get_job_by_slug`), filters it against the Pixelup ICP
(`scraper/icp/`), and shows the result in a small Next.js app.

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
- **The login token can act on the whole Contra account.** Keep this repo private and limit who has
  write access.

`scraper/contra.test.ts` checks these rules.

## Automatic runs (GitHub Actions)

`.github/workflows/scrape.yml` runs once a day at **11:05 AM San Francisco time**, plus on demand from
Actions → "Daily Contra scrape" → Run workflow. Each run commits `data/latest.json`,
`data/runs/` and `data/seen-ids.json`.

Repository secrets (Settings → Secrets and variables → Actions):

| Secret | Source |
|---|---|
| `CONTRA_CLIENT_ID` | `.contra-auth.json` after `npm run contra:auth` |
| `CONTRA_REFRESH_TOKEN` | same |
| `ANTHROPIC_API_KEY` | Claude API key for the ICP classifier |
| `GH_SECRETS_PAT` | Fine-grained PAT for this repo with **Secrets: Read and write**. Contra rotates the refresh token on every use; the workflow stores the new one with this. |

### Switching the Contra account (e.g. on another machine)

Needs Node 22.18+ (24 recommended) and a clone of this repo; no `npm install` needed for this step.

1. Run `npm run contra:auth`. Open the login link it prints in a **private/incognito window** and
   log in with the account to use; a browser already logged in to Contra connects that account
   without asking. The login must finish in a browser on the same computer.
2. Check the `Connected Contra account:` line shows the right person and "Contra Pro".
3. Copy both values from `.contra-auth.json` into the secrets above, then delete the file.
4. Don't run `npm run scrape:fetch` / `scrape:ci` locally with a token GitHub is using:
   each use rotates it and invalidates the other copy.

## Filtering

`ICP_CLASSIFIER` picks the filter: `regex` (default, rules from `scraper/icp/icp-brief.md`),
`none` (keep every job), `anthropic` or `openai`. Housekeeping filters are in
`scraper/filters.ts`.

The GitHub workflow uses `anthropic` with Claude Sonnet 5.5 (needs the `ANTHROPIC_API_KEY` repository
secret). Claude reads each job against `icp-brief.md`, sizes it (which sprints it maps to, the actual
scope, the estimated total value) and only qualifies jobs worth at least $10,000. Jobs the regex rules
hard-reject skip Claude, and each verdict is cached in `data/verdicts/` so a job is only sent once.

## Local use

- `npm run dev`: the jobs app at http://localhost:3000 (reads `data/latest.json`)
- `/contra-scrape` in Claude Code: scrape through Claude Code's own Contra MCP login
- `npm test`: ICP rule tests
