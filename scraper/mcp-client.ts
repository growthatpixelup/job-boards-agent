// Minimal client for Contra's remote MCP server (streamable HTTP + OAuth), so the
// scrape can run without Claude Code, e.g. in GitHub Actions. Only used for
// read-only tools; see READ_ONLY_TOOLS.

export const MCP_URL = "https://contra.com/mcp";
export const OAUTH_BASE = "https://contra.com/api/mcp/oauth";

/** The only tools this client will call. Anything else is refused before it reaches Contra. */
const READ_ONLY_TOOLS = new Set(["whoami", "list_job_feed", "get_job_by_slug"]);

export interface Tokens {
  accessToken: string;
  /** Contra may rotate the refresh token on every use; always persist the latest one. */
  refreshToken: string;
}

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ resource: MCP_URL, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`token request failed (${res.status}): ${body.error_description ?? body.error ?? "no access_token"}`);
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? params.refresh_token };
}

export const exchangeCode = (clientId: string, code: string, redirectUri: string, codeVerifier: string) =>
  tokenRequest({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirectUri, code_verifier: codeVerifier });

export const refreshTokens = (clientId: string, refreshToken: string) =>
  tokenRequest({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken });

/** Reads a JSON-RPC response that may arrive as plain JSON or as a server-sent event stream. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readRpc(res: Response, id: number): Promise<any> {
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 300)}`);
  const messages = (res.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)))
    : [JSON.parse(text)];
  const msg = messages.find((m) => m.id === id);
  if (!msg) throw new Error("MCP response had no matching JSON-RPC reply");
  if (msg.error) throw new Error(`MCP error ${msg.error.code}: ${msg.error.message}`);
  return msg.result;
}

/** "@username" plus whether the feed is limited to a preview (no Contra Pro). Uses only read-only tools. */
export async function describeAccount(mcp: ContraMcp): Promise<string> {
  const me = await mcp.call("whoami");
  if (!me?.isAuthenticated) throw new Error("the Contra login is not authenticated");
  const profile = me.visitor?.userAccount?.profile;
  const feed = await mcp.call("list_job_feed", { preset: "ALL", first: 1 });
  const name = [profile?.firstName?.trim(), profile?.lastName?.trim()].filter(Boolean).join(" ");
  return `@${profile?.displayUsername ?? "unknown"}${name ? ` (${name})` : ""} · ${
    feed?.accessLimitedFeed ? "NO Contra Pro: only a small preview of the job board is visible" : "Contra Pro: full job board visible"
  }`;
}

export class ContraMcp {
  private accessToken: string;
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async post(body: object): Promise<Response> {
    return fetch(MCP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async rpc(method: string, params: object): Promise<any> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method, params });
    this.sessionId ??= res.headers.get("mcp-session-id");
    return readRpc(res, id);
  }

  async connect(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "contra-scrapper", version: "0.1.0" },
    });
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** Calls a read-only tool and returns its JSON payload, exactly as Claude Code would see it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async call(name: string, args: object = {}): Promise<any> {
    if (!READ_ONLY_TOOLS.has(name)) throw new Error(`refusing to call "${name}": not a read-only tool`);
    const result = await this.rpc("tools/call", { name, arguments: args });
    const text = result?.content?.find((c: { type: string }) => c.type === "text")?.text;
    const payload = result?.structuredContent ?? (text ? JSON.parse(text) : null);
    if (result?.isError) throw new Error(`${name} failed: ${text ?? "unknown error"}`);
    return payload;
  }
}
