"use client";

import { useState, useTransition } from "react";
import { syncContra } from "./actions.ts";

/** Local only (page.tsx hides it on Vercel): pulls applied jobs and unread replies from Contra. */
export function SyncButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function sync() {
    setMessage(null);
    startTransition(async () => {
      try {
        setMessage(await syncContra());
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Sync failed");
      }
    });
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
