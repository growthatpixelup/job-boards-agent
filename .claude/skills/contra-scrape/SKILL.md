---
name: contra-scrape
description: Fetch the Contra job feed through the Contra MCP server, filter it against the Pixelup ICP, and refresh data/latest.json for the jobs app. Use when asked to scrape, fetch, refresh or update Contra jobs.
---

# Scrape Contra jobs via MCP

Arguments (optional): a feed preset — `ALL` (default), `FOR_YOU`, `BOOKMARKED`, `APPLIED`, `CLOSED`, `NOT_A_FIT`.

1. Call `mcp__contra__whoami`. If it is not authenticated, stop and tell the user to run `/mcp` and authenticate the `contra` server.
2. Call `mcp__contra__list_job_feed` with `preset` (default `ALL`), `first: 100`, `sort: "NEWEST"`.
3. Save each response **verbatim** (the full JSON object the tool returned, unmodified) with the Write tool to `data/raw/page-1.json`, `data/raw/page-2.json`, … in this project.
4. While `hasNextPage` is true and fewer than 5 pages are saved, call again with `after: <endCursor>` and save the next page.
5. Run `npm run scrape:pending --silent`. Its stdout is a JSON array of job slugs whose descriptions are needed (already-cached ones are left out). With an LLM classifier that is every job the first time, since Claude reads them all; with the regex classifier, jobs the title/budget prescreen rejects are left out too.
6. For each slug, call `mcp__contra__get_job_by_slug` and save the response **verbatim** to `data/details/<slug>.json`. Skip any that error; the classifier treats a missing description conservatively. The next step cuts each file down to the description text, with contact details removed.
7. Run `npm run scrape -- <preset>`. It classifies every job against the ICP (`scraper/icp/`), writes `data/latest.json` and `data/runs/<date>.json`, and deletes `data/raw/` (descriptions stay cached in `data/details/`).
8. Report the summary: counts per decision, and the qualified/maybe jobs with their lane (sprint, entry, outreach) and links. If the feed is access-limited (no Contra Pro), say so once, briefly.

Do not apply to, bookmark or dismiss any job — this skill only reads.

Use only the three Contra MCP tools above to get data from Contra. Never load contra.com pages any other way — no WebFetch, WebSearch, browser automation, curl or scripts. If the Contra MCP is unavailable or errors, stop and report it instead of falling back.
