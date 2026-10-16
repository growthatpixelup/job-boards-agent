"use client";

import { useState, type ReactNode } from "react";
import { syncContra, syncStatus } from "./actions.ts";

const POLL_MS = 5_000;
const GIVE_UP_MS = 8 * 60_000; // a scrape that re-reads the board can take a few minutes

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads the Contra account again: on the hosted dashboard by starting a scrape in GitHub Actions (Daksh's login,
 * no Slack post) and following it; locally, with the local login. The page's data reloads when it finishes.
 */
export function SyncButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<ReactNode>(null);

  async function sync() {
    setPending(true);
    setMessage(null);
    try {
      const res = await syncContra();
      if ("done" in res) return setMessage(res.done);
      setMessage("Syncing with Contra… about a minute");
      for (const start = Date.now(); Date.now() - start < GIVE_UP_MS; ) {
        await sleep(POLL_MS);
        const run = await syncStatus(res.started);
        if (run.status === "done") return setMessage(run.summary ?? "Synced");
        if (run.status === "failed") {
          return setMessage(
            <>
              Sync {run.conclusion === "cancelled" ? "was cancelled" : "failed"} ·{" "}
              <a href={run.url} target="_blank" rel="noreferrer" className="underline hover:text-brand">
                open the run
              </a>
            </>,
          );
        }
        setMessage(run.status === "running" ? "Syncing with Contra… reading the board" : "Syncing with Contra… waiting for GitHub");
      }
      setMessage("Still running on GitHub: reload the page in a minute");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex items-baseline gap-3">
      {message && (
        <span role="status" className="text-sm text-muted-foreground">
          {message}
        </span>
      )}
      <button type="button" onClick={sync} disabled={pending} className="rounded-sm text-muted-foreground hover:text-brand disabled:opacity-50">
        {pending ? "Syncing…" : "Sync from Contra"}
      </button>
    </span>
  );
}
