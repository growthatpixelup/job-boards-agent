// Optional password for a hosted copy: set DASHBOARD_PASSWORD and the browser asks for it (any username).
// proxy.ts checks every request; the stage action checks again, since server actions can be POSTed directly.

export const PASSWORD = process.env.DASHBOARD_PASSWORD || null;

export function isAuthorized(authorization: string | null): boolean {
  if (!PASSWORD) return true;
  if (!authorization?.startsWith("Basic ")) return false;
  const decoded = atob(authorization.slice(6));
  const given = decoded.slice(decoded.indexOf(":") + 1);
  // Constant-time compare.
  let diff = given.length ^ PASSWORD.length;
  for (let i = 0; i < Math.max(given.length, PASSWORD.length); i++) {
    diff |= (given.charCodeAt(i) || 0) ^ (PASSWORD.charCodeAt(i) || 0);
  }
  return diff === 0;
}
