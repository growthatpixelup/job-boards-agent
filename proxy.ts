import { NextResponse, type NextRequest } from "next/server";
import { isAuthorized, LOCKED } from "./lib/auth.ts";

export function proxy(request: NextRequest) {
  if (isAuthorized(request.headers.get("authorization"))) return NextResponse.next();
  if (LOCKED) return new NextResponse("Locked: set DASHBOARD_PASSWORD in the Vercel project settings, then redeploy.", { status: 503 });
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Pixelup leads", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
