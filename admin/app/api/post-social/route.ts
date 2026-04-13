/**
 * POST /api/post-social
 *
 * Posts an article to all connected social platforms via Post for Me.
 *
 * Flow:
 *  1. Generate the Instagram card PNG (always — used for Instagram post)
 *  2. Upload it to Post for Me media hosting to get a public URL
 *  3. Post text-only to Bluesky, X, Threads, Facebook
 *  4. Post with the card image to Instagram
 *
 * Body: { id: number }
 */

import db from "@/lib/db";
import { generateInstagramCardPng } from "@/lib/instagram-card";

const PFM_BASE  = "https://api.postforme.dev/v1";
const API_KEY   = process.env.POSTFORME_API_KEY!;
const SITE_BASE = "https://positron.today";

/** Returns the enabled account IDs + their platforms from DB + Post for Me. */
async function getEnabledAccounts(): Promise<{ id: string; platform: string }[]> {
  // 1. Read enabled IDs from settings
  const settingsResult = await db.execute({
    sql:  "SELECT value FROM settings WHERE key = 'postforme_enabled_accounts'",
    args: [],
  });
  if (settingsResult.rows.length === 0) return [];

  let enabledIds: string[] = [];
  try {
    enabledIds = JSON.parse(String(settingsResult.rows[0].value));
  } catch { return []; }
  if (enabledIds.length === 0) return [];

  // 2. Fetch account list from Post for Me to get platform info
  const pfmRes = await fetch(`${PFM_BASE}/social-accounts`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    cache: "no-store",
  });
  if (!pfmRes.ok) return [];

  const pfmData = await pfmRes.json();
  const allAccounts: { id: string; platform: string }[] = (pfmData.data ?? []).map(
    (a: Record<string, string>) => ({ id: a.id, platform: a.platform }),
  );

  // 3. Filter to only the enabled ones
  return allAccounts.filter((a) => enabledIds.includes(a.id));
}

function pfmHeaders() {
  return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };
}

function buildCaption(article: Record<string, unknown>): string {
  const emoji   = String(article.article_emoji ?? "✨");
  const title   = String(article.title_en ?? article.title_nl ?? "");
  const summary = String(article.summary_en ?? "");

  const slug = article.published_path
    ? String(article.published_path).split("/").pop()?.replace(/\.md$/, "")
    : null;
  const url = slug ? `${SITE_BASE}/posts/${slug}/` : SITE_BASE;

  const prefix = `${emoji} ${title}\n\n`;
  const suffix = `\n\n${url}`;

  // X shortens URLs to 23 chars via t.co (280 char limit).
  // Bluesky counts the full URL length (300 char limit).
  // Use the most restrictive budget so the URL is never truncated on any platform.
  const xBudget       = 280 - 23          - 2 - prefix.length; // 23 = t.co, 2 = \n\n
  const blueskyBudget = 300 - url.length  - 2 - prefix.length; // full URL, 2 = \n\n
  const budget = Math.max(0, Math.min(xBudget, blueskyBudget));

  const snippet = budget > 0
    ? summary.length > budget ? summary.slice(0, budget - 1) + "…" : summary
    : "";

  return `${prefix}${snippet}${suffix}`;
}

async function uploadCardToPostForMe(png: Buffer): Promise<string> {
  // Step 1: get a signed upload URL
  const urlRes = await fetch(`${PFM_BASE}/media/create-upload-url`, {
    method:  "POST",
    headers: pfmHeaders(),
    body:    JSON.stringify({ content_type: "image/png" }),
  });
  if (!urlRes.ok) {
    const err = await urlRes.json().catch(() => ({}));
    throw new Error(`Post for Me media URL failed: ${err.message ?? urlRes.status}`);
  }
  const { upload_url, media_url } = await urlRes.json();

  // Step 2: PUT the PNG to the signed URL
  const putRes = await fetch(upload_url, {
    method:  "PUT",
    headers: { "Content-Type": "image/png" },
    body:    new Uint8Array(png),
  });
  if (!putRes.ok) {
    throw new Error(`Media upload failed: ${putRes.status}`);
  }

  return media_url as string;
}

async function postToPlatforms(
  accounts: string[],
  caption: string,
  mediaUrl?: string,
): Promise<{ id: string; status: string }> {
  const body: Record<string, unknown> = { caption, social_accounts: accounts };
  if (mediaUrl) body.media = [{ url: mediaUrl }];

  const res = await fetch(`${PFM_BASE}/social-posts`, {
    method:  "POST",
    headers: pfmHeaders(),
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? `Post for Me error ${res.status}`);
  return { id: data.id, status: data.status };
}

export async function POST(request: Request) {
  if (!API_KEY) {
    return Response.json({ error: "POSTFORME_API_KEY is not set." }, { status: 500 });
  }

  const { id } = await request.json().catch(() => ({}));
  if (!id) return Response.json({ error: "Missing article id." }, { status: 400 });

  // Fetch article
  const result = await db.execute({
    sql: "SELECT * FROM articles WHERE id = ?",
    args: [id],
  });
  const article = result.rows[0];
  if (!article) return Response.json({ error: `Article ${id} not found.` }, { status: 404 });

  // Fetch enabled accounts from DB + Post for Me
  const enabledAccounts = await getEnabledAccounts();
  if (enabledAccounts.length === 0) {
    return Response.json(
      { error: "No social accounts enabled. Configure them in Settings → Social publishing." },
      { status: 400 },
    );
  }

  const instagramAccounts = enabledAccounts.filter((a) => a.platform === "instagram");
  const textAccounts      = enabledAccounts.filter((a) => a.platform !== "instagram");

  const caption  = buildCaption(article as Record<string, unknown>);
  const title    = String(article.title_en ?? article.title_nl ?? "");
  const emoji    = String(article.article_emoji ?? "✨");
  const source   = String(article.source_name ?? "");
  const imageUrl = article.image_url ? String(article.image_url) : null;

  const results: Record<string, unknown> = {};
  const errors:  string[]                = [];

  // ── 1. Generate & upload Instagram card (only if Instagram is enabled) ─────
  let cardMediaUrl: string | null = null;
  if (instagramAccounts.length > 0) {
    try {
      const png = await generateInstagramCardPng({ title, emoji, source, imageUrl });
      cardMediaUrl = await uploadCardToPostForMe(png);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[post-social] Card generation/upload failed:", msg);
      errors.push(`Instagram card: ${msg}`);
    }
  }

  // ── 2. Post text-only to non-Instagram platforms ──────────────────────────
  if (textAccounts.length > 0) {
    try {
      results.text = await postToPlatforms(textAccounts.map((a) => a.id), caption);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[post-social] Text post failed:", msg);
      errors.push(`Text platforms: ${msg}`);
    }
  }

  // ── 3. Post with card image to Instagram ──────────────────────────────────
  if (cardMediaUrl && instagramAccounts.length > 0) {
    try {
      results.instagram = await postToPlatforms(
        instagramAccounts.map((a) => a.id),
        caption,
        cardMediaUrl,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[post-social] Instagram post failed:", msg);
      errors.push(`Instagram: ${msg}`);
    }
  }

  const anySuccess = Object.keys(results).length > 0;

  return Response.json({
    ok:            anySuccess,
    results,
    platforms:     enabledAccounts.map((a) => a.platform),
    card_uploaded: !!cardMediaUrl,
    errors:        errors.length > 0 ? errors : undefined,
  }, { status: anySuccess ? 200 : 500 });
}
