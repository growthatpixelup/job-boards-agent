import { describeSync, syncFromContra } from "../lib/contra-sync.ts";

// Local sync with Contra: moves jobs you applied to into the Applied stage and reports unread conversations.
// Usage: npm run contra:sync   (needs `npm run contra:auth` once, and the Supabase keys in .env.local)

syncFromContra()
  .then((r) => console.log(`[contra] ${describeSync(r)}`))
  .catch((err) => {
    console.error(`[contra] SYNC FAILED: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  });
