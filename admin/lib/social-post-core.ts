/**
 * Social posting core logic — extracted from the API route so both the
 * serverless endpoint and the unified self-hosted pipeline can call it.
 */

import db from "@/lib/db";
import { postArticleToSocial } from "@/app/api/post-social/route";

const SITE_BASE = "https://positron.today";

export async function isUrlLive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface SocialPostResult {
  processed: number;
  posted: number;
  skipped: number;
  results: Array<{
    id: number;
    title: string;
    posted: boolean;
    skippedFor?: "url-not-live" | "no-published-path";
    error?: string;
  }>;
}

/**
 * Find articles pending social posting and post them.
 * @param waitForLive If true, wait up to maxWaitSeconds for each URL to become live.
 */
export async function postPendingSocial(options?: { waitForLive?: boolean; maxWaitSeconds?: number }): Promise<SocialPostResult> {
  const waitForLive = options?.waitForLive ?? false;
  const maxWaitMs = (options?.maxWaitSeconds ?? 120) * 1000;

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
    return { processed: 0, posted: 0, skipped: 0, results: [] };
  }

  console.log(`[post-pending-social] Found ${pending.rows.length} article(s) pending social post`);

  const results: SocialPostResult["results"] = [];

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

    // Check if the URL is live
    let live = await isUrlLive(url);

    // In self-hosted mode, we can wait for the URL to become live
    if (!live && waitForLive) {
      console.log(`[post-pending-social] Waiting for ${url} to become live...`);
      const start = Date.now();
      while (!live && Date.now() - start < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 10_000)); // check every 10s
        live = await isUrlLive(url);
      }
      if (live) {
        console.log(`[post-pending-social] ${url} is now live after ${Math.round((Date.now() - start) / 1000)}s`);
      }
    }

    if (!live) {
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
  return { processed: results.length, posted, skipped, results };
}
