/**
 * Post Pending Social
 *
 * Triggered by the GitHub Pages deploy workflow once it finishes — i.e.
 * the moment when newly-published articles are actually live on
 * positron.today and safe to link to from social posts.
 *
 * Finds articles with:
 *   • status            = 'published'
 *   • post_to_social_on_publish = 1
 *   • social_posted_at IS NULL
 *   • published_at >= now() - 24h        (don't retry forever)
 *
 * For each, defensively HEAD-checks the article URL (the Pages deploy
 * succeeded, but DNS / cache propagation can lag a few seconds), then
 * calls postArticleToSocial which handles platform fan-out and writes
 * social_posted_at on success.
 *
 * Auth: Bearer token. Env var SOCIAL_POST_TOKEN; the GitHub Action sends
 * the same value via the Authorization header. Without the env var set,
 * the endpoint refuses every request — no machine on the open internet
 * should be able to trigger social posts.
 *
 * POST /api/post-pending-social
 *   Headers: Authorization: Bearer <SOCIAL_POST_TOKEN>
 *   Response: { processed, posted, skipped, results: [...] }
 */

import db from "@/lib/db";
import { postArticleToSocial } from "@/app/api/post-social/route";

const SITE_BASE = "https://positron.today";

// Constant-time string comparison — defends against timing attacks even
// though the surface here is small. Belt-and-braces.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function isUrlLive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const expected = process.env.SOCIAL_POST_TOKEN ?? "";
  if (!expected) {
    return Response.json({ error: "SOCIAL_POST_TOKEN is not configured." }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match || !safeEqual(match[1].trim(), expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Find pending ──────────────────────────────────────────────────────────
  const pending = await db.execute(`
    SELECT id, title_en, title_nl, published_path, published_at
    FROM articles
    WHERE status = 'published'
      AND post_to_social_on_publish = 1
      AND social_posted_at IS NULL
      AND published_at >= datetime('now', '-24 hours')
    ORDER BY published_at ASC
  `);

  if (pending.rows.length === 0) {
    return Response.json({ processed: 0, posted: 0, skipped: 0, results: [] });
  }

  console.log(`[post-pending-social] Found ${pending.rows.length} article(s) pending social post`);

  type Outcome = {
    id:          number;
    title:       string;
    posted:      boolean;
    skippedFor?: "url-not-live" | "no-published-path";
    error?:      string;
  };

  const results: Outcome[] = [];

  for (const row of pending.rows) {
    const id    = Number(row.id);
    const title = String(row.title_en ?? row.title_nl ?? `#${id}`);
    const path  = row.published_path ? String(row.published_path) : "";

    if (!path) {
      results.push({ id, title, posted: false, skippedFor: "no-published-path" });
      console.warn(`[post-pending-social] Skipping ${id}: no published_path`);
      continue;
    }

    const slug = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
    const url  = `${SITE_BASE}/posts/${slug}/`;

    // Defensive — the GitHub Action only fires this endpoint after the deploy
    // step succeeds, but Pages' CDN can lag a few seconds behind. If the URL
    // is not yet 200, leave the article in pending state for the next call.
    if (!(await isUrlLive(url))) {
      results.push({ id, title, posted: false, skippedFor: "url-not-live" });
      console.warn(`[post-pending-social] Skipping ${id}: ${url} not yet live`);
      continue;
    }

    try {
      const r = await postArticleToSocial(id);
      if (r.ok) {
        results.push({ id, title, posted: true });
        console.log(`[post-pending-social] Posted ${id} to social`);
      } else {
        results.push({ id, title, posted: false, error: r.error ?? "post failed" });
        console.error(`[post-pending-social] Posting ${id} failed: ${r.error ?? "unknown"}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id, title, posted: false, error: msg });
      console.error(`[post-pending-social] Posting ${id} threw: ${msg}`);
    }
  }

  const posted  = results.filter((r) => r.posted).length;
  const skipped = results.filter((r) => !r.posted).length;
  return Response.json({
    processed: results.length,
    posted,
    skipped,
    results,
  });
}
