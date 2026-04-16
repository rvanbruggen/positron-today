import { NextRequest, NextResponse } from "next/server";

const COOKIE     = "admin_session";
const COOKIE_MSG = "positron-admin-v1";

async function makeToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(COOKIE_MSG));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: NextRequest) {
  const secret = process.env.ADMIN_SECRET ?? "";
  if (!secret) {
    return NextResponse.json({ error: "ADMIN_SECRET is not configured on the server." }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const { password } = body as { password?: string };

  if (!password || password !== secret) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token    = await makeToken(secret);
  const response = NextResponse.json({ ok: true });

  response.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   60 * 60 * 24 * 30, // 30 days
    path:     "/",
  });

  return response;
}
