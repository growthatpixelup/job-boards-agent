import { readFile } from "node:fs/promises";
import path from "node:path";
import { SHEET_HEADERS, SHEET_KEY, sheetRows } from "./announce.ts";
import { DATA_DIR } from "./feed.ts";
import { LEADS_DIR, type Lead } from "./leads.ts";
import type { RunResult } from "./types.ts";

// Appends the latest run's full-time leads (company links + founders from data/leads/) to the Google Sheet,
// through the Apps Script web app in scripts/leads-sheet.gs, which skips jobs already in the sheet.
// Env: LEADS_WEBHOOK_URL + LEADS_WEBHOOK_TOKEN (skips quietly when the URL is unset),
//      SHEET_DRY_RUN=1 prints the rows instead.

async function main() {
  const run = JSON.parse(await readFile(path.join(DATA_DIR, "latest.json"), "utf8")) as RunResult;
  const leads = new Map<string, Lead>();
  for (const j of run.jobs.filter((j) => j.announce && j.lane === "outreach")) {
    try {
      leads.set(j.id, JSON.parse(await readFile(path.join(LEADS_DIR, `${j.id}.json`), "utf8")) as Lead);
    } catch {
      // not looked up (lookup off or failed): the row still goes in, without links
    }
  }
  const rows = sheetRows(run, leads);
  if (!rows.length) return void console.log("[sheet] no new full-time leads");
  if (process.env.SHEET_DRY_RUN) return void console.log(JSON.stringify({ headers: SHEET_HEADERS, rows }, null, 2));
  const url = process.env.LEADS_WEBHOOK_URL;
  if (!url) return void console.log(`[sheet] LEADS_WEBHOOK_URL not set; skipping ${rows.length} lead(s)`);

  // Apps Script answers a POST with a redirect to the result, which fetch follows.
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: process.env.LEADS_WEBHOOK_TOKEN ?? "", key: SHEET_KEY, headers: SHEET_HEADERS, rows }),
  });
  const text = await res.text();
  let body: { ok?: boolean; added?: number; error?: string } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    // an HTML error page; reported below
  }
  if (!res.ok || !body?.ok) throw new Error(`lead sheet webhook failed (${res.status}): ${(body?.error ?? text).slice(0, 200)}`);
  console.log(`[sheet] added ${body.added} lead(s) to the Google Sheet${rows.length > (body.added ?? 0) ? ` (${rows.length - (body.added ?? 0)} already there)` : ""}`);
}

main().catch((err) => {
  console.error(`[sheet] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
