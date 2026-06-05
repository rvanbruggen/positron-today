/**
 * Post Pending Social
 *
 * Triggered by the GitHub Pages deploy workflow once it finishes.
 * Auth: Bearer token via SOCIAL_POST_TOKEN env var.
 *
 * Core logic is in lib/social-post-core.ts; this route handles auth
 * and HTTP concerns.
 *
 * POST /api/post-pending-social
 */

import { postPendingSocial } from "@/lib/social-post-core";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  const expected = process.env.SOCIAL_POST_TOKEN ?? "";
  if (!expected) {
    return Response.json({ error: "SOCIAL_POST_TOKEN is not configured." }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match || !safeEqual(match[1].trim(), expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await postPendingSocial();
  return Response.json(result);
}
