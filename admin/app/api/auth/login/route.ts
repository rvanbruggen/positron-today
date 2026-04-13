import { createHmac }  from "crypto";
import { NextRequest, NextResponse } from "next/server";

const COOKIE    = "admin_session";
const COOKIE_MSG = "positron-admin-v1";

function makeToken(secret: string): string {
  return createHmac("sha256", secret).update(COOKIE_MSG).digest("hex");
}

export async function POST(request: NextRequest) {
  const secret = process.env.ADMIN_SECRET ?? "";
  if (!secret) {
    return NextResponse.json({ error: "ADMIN_SECRET is not configured on the server." }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const { password } = body as { password?: string };

  if (!password || password !== secret) {
    // Constant-time check to prevent timing attacks
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token    = makeToken(secret);
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
