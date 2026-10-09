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

`.github/workflows/scrape.yml` runs at **08:00 and 20:00 IST**, plus on demand from
Actions → "Daily Contra scrape" → Run workflow. Each run commits `data/latest.json`,
`data/runs/` and `data/seen-ids.json`.

Repository secrets (Settings → Secrets and variables → Actions):

| Secret | Source |
|---|---|
| `CONTRA_CLIENT_ID` | `.contra-auth.json` after `npm run contra:auth` |
| `CONTRA_REFRESH_TOKEN` | same |
| `GH_SECRETS_PAT` | Fine-grained PAT for this repo with **Secrets: Read and write**. Contra rotates the refresh token on every use; the workflow stores the new one with this. |

### Switching the Contra account (e.g. on another machine)

1. `npm install`, then `npm run contra:auth` and log in with the account to use.
2. Copy both values from `.contra-auth.json` into the secrets above, then delete the file.
3. Don't run `npm run scrape:fetch` / `scrape:ci` locally with a token GitHub is using:
   each use rotates it and invalidates the other copy.

## Filtering

`ICP_CLASSIFIER` picks the filter: `regex` (default, rules from `scraper/icp/icp-brief.md`),
`none` (keep every job), `anthropic` or `openai`. Housekeeping filters are in
`scraper/filters.ts`.

## Local use

- `npm run dev`: the jobs app at http://localhost:3000 (reads `data/latest.json`)
- `/contra-scrape` in Claude Code: scrape through Claude Code's own Contra MCP login
- `npm test`: ICP rule tests
