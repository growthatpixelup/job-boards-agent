// Google Apps Script for the Contra lead sheet. Receives full-time-role leads from the GitHub workflow
// (scraper/sheet.ts) and appends them to a "Leads" tab, skipping jobs already in the sheet.
//
// Setup, once (README → "Lead sheet"):
//   1. In the Google Sheet: Extensions → Apps Script, replace the editor contents with this file.
//   2. Set TOKEN below to a long random string (e.g. from `openssl rand -hex 24`).
//   3. Deploy → New deployment → type "Web app", Execute as "Me", Who has access "Anyone" → Deploy,
//      and copy the web app URL.
//   4. Add GitHub repository secrets LEADS_WEBHOOK_URL (that URL) and LEADS_WEBHOOK_TOKEN (the same string).
// After editing this script, deploy a new version (Deploy → Manage deployments → Edit → New version).

const TOKEN = "change-me"; // must match the LEADS_WEBHOOK_TOKEN repository secret
const TAB = "Leads";

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (TOKEN === "change-me" || body.token !== TOKEN) return reply({ ok: false, error: "bad token" });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = book.getSheetByName(TAB) || book.insertSheet(TAB);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(body.headers);
      sheet.setFrozenRows(1);
    }
    // Columns are matched by header name, so the team can move columns or add their own (e.g. "Owner").
    let header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const missing = body.headers.filter((h) => header.indexOf(h) < 0);
    if (missing.length) {
      sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
      header = header.concat(missing);
    }

    const keyColumn = header.indexOf(body.key) + 1;
    const lastRow = sheet.getLastRow();
    const existing = new Set(
      lastRow < 2 ? [] : sheet.getRange(2, keyColumn, lastRow - 1, 1).getValues().map((r) => String(r[0])),
    );
    const keyIndex = body.headers.indexOf(body.key);
    const rows = body.rows
      .filter((r) => !existing.has(String(r[keyIndex])))
      .map((r) => header.map((h) => (body.headers.indexOf(h) < 0 ? "" : r[body.headers.indexOf(h)])));
    if (rows.length) sheet.getRange(lastRow + 1, 1, rows.length, header.length).setValues(rows);
    return reply({ ok: true, added: rows.length });
  } finally {
    lock.releaseLock();
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
