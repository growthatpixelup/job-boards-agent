import { exec } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { ContraMcp, MCP_URL, OAUTH_BASE, describeAccount, exchangeCode } from "../scraper/mcp-client.ts";

// One-time login for the GitHub Actions scrape. Registers an OAuth client with
// Contra's MCP server, opens the browser to log in, and saves the client id +
// refresh token to .contra-auth.json (gitignored) for you to add as repo secrets.
// Usage: npm run contra:auth

const PORT = 8976;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const OUT_FILE = path.resolve(import.meta.dirname, "..", ".contra-auth.json");

const b64url = (buf: Buffer) => buf.toString("base64url");

async function register(): Promise<string> {
  const res = await fetch(`${OAUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "contra-scrapper (GitHub Actions)",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp:tools",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.client_id) throw new Error(`client registration failed (${res.status}): ${JSON.stringify(body)}`);
  return body.client_id;
}

function waitForCode(state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/callback") return void res.writeHead(404).end();
      const code = url.searchParams.get("code");
      const ok = code && url.searchParams.get("state") === state;
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/plain" });
      res.end(ok ? "Contra login complete. You can close this tab." : `Login failed: ${url.searchParams.get("error") ?? "bad state"}`);
      server.close();
      if (ok) resolve(code);
      else reject(new Error(`authorization failed: ${url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "state mismatch"}`));
    });
    server.listen(PORT, "127.0.0.1");
    setTimeout(() => (server.close(), reject(new Error("timed out waiting for the browser login"))), 5 * 60_000).unref();
  });
}

async function main() {
  const clientId = await register();
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  const authUrl = new URL(`${OAUTH_BASE}/authorize`);
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    scope: "mcp:tools",
    state,
    resource: MCP_URL,
  }).toString();

  const codePromise = waitForCode(state);
  console.log(`Opening the Contra login in your browser. If it doesn't open, visit:\n\n  ${authUrl}\n`);
  const opener = process.platform === "win32" ? `start "" "${authUrl}"` : process.platform === "darwin" ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(opener);

  const tokens = await exchangeCode(clientId, await codePromise, REDIRECT_URI, verifier);
  await writeFile(
    OUT_FILE,
    JSON.stringify({ CONTRA_CLIENT_ID: clientId, CONTRA_REFRESH_TOKEN: tokens.refreshToken }, null, 2) + "\n",
    { mode: 0o600 },
  );
  // Show which account was connected, using the short-lived access token (the saved refresh token is untouched).
  try {
    const mcp = new ContraMcp(tokens.accessToken);
    await mcp.connect();
    console.log(`Connected Contra account: ${await describeAccount(mcp)}\n`);
  } catch (err) {
    console.warn(`Couldn't confirm which account was connected: ${err instanceof Error ? err.message : err}\n`);
  }
  console.log(
    `Saved to ${OUT_FILE}\n\n` +
      "Add both values as repository secrets (GitHub → Settings → Secrets and variables → Actions):\n" +
      "  CONTRA_CLIENT_ID, CONTRA_REFRESH_TOKEN\n" +
      "Then delete .contra-auth.json.",
  );
}

main().catch((err) => {
  console.error(`[contra-auth] ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
