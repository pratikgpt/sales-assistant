import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

// Public: Meta webhooks (signature-checked), the cron poll (bearer secret) and the login flow.
const PUBLIC = [/^\/api\/webhooks\//, /^\/api\/email\/poll$/, /^\/login$/, /^\/api\/login$/];

export async function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password || PUBLIC.some((r) => r.test(req.nextUrl.pathname))) return NextResponse.next();
  if (req.cookies.get(AUTH_COOKIE)?.value === (await authToken(password))) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/|favicon.ico|icon.svg).*)"] };
