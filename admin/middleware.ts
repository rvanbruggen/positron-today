/**
 * Admin authentication middleware.
 *
 * Every request (except /login and /api/auth/*) requires a valid session cookie.
 * The cookie value is HMAC-SHA256(ADMIN_SECRET, "positron-admin-v1").
 *
 * If ADMIN_SECRET is not set the middleware is a no-op (dev without auth).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE = "admin_session";

async function makeToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("positron-admin-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow the login page and auth API through
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const secret = process.env.ADMIN_SECRET ?? "";
  if (!secret) {
    // No secret configured — auth disabled (local dev without .env.local entry)
    return NextResponse.next();
  }

  const expected = await makeToken(secret);
  const session  = request.cookies.get(COOKIE)?.value;

  if (session === expected) {
    return NextResponse.next();
  }

  // API routes: return 401 JSON instead of redirect
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // All other routes: redirect to login
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
