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
import { generateInstagramCardOg } from "@/lib/instagram-card-og";
import {
  getEnabledAccounts,
  uploadCardToPostForMe,
  postToPlatforms,
  twitterLen,
  isUrlLive,
  getApiKey,
} from "@/lib/social-helpers";

const SITE_BASE = "https://positron.today";

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

  const SAFETY = 5;
  const xBudget       = 280 - url.length       - 2 - twitterLen(prefix) - SAFETY;
  const blueskyBudget = 300 - url.length        - 2 - prefix.length;
  const budget = Math.max(0, Math.min(xBudget, blueskyBudget));

  const snippet = budget > 0
    ? summary.length > budget ? summary.slice(0, budget - 1) + "…" : summary
    : "";

  return `${prefix}${snippet}${suffix}`;
}

export type PostArticleResult = {
  ok:            boolean;
  status:        number;
  results?:      Record<string, unknown>;
  platforms?:    string[];
  card_uploaded?: boolean;
  errors?:       string[];
  warning?:      string;
  error?:        string;
};

/**
 * In-process social posting — callable from other server routes (publish,
 * publish-scheduled) so they don't have to make an HTTP call that the admin
 * auth middleware would 401.
 */
/**
 * @param id          Article ID
 * @param platforms   Optional array of platform names to post to (e.g. ["instagram"]).
 *                    When omitted, posts to all enabled accounts.
 */
export async function postArticleToSocial(id: number, platforms?: string[]): Promise<PostArticleResult> {
  if (!getApiKey()) {
    return { ok: false, status: 500, error: "POSTFORME_API_KEY is not set." };
  }

  const result = await db.execute({
    sql: "SELECT * FROM articles WHERE id = ?",
    args: [id],
  });
  const article = result.rows[0];
  if (!article) return { ok: false, status: 404, error: `Article ${id} not found.` };

  let enabledAccounts = await getEnabledAccounts();
  if (enabledAccounts.length === 0) {
    return { ok: false, status: 400, error: "No social accounts enabled. Configure them in Settings → Social publishing." };
  }

  // When specific platforms are requested, filter to just those
  if (platforms && platforms.length > 0) {
    enabledAccounts = enabledAccounts.filter((a) => platforms.includes(a.platform));
    if (enabledAccounts.length === 0) {
      return { ok: false, status: 400, error: `No enabled accounts for platform(s): ${platforms.join(", ")}` };
    }
  }

  const instagramAccounts = enabledAccounts.filter((a) => a.platform === "instagram");
  const textAccounts      = enabledAccounts.filter((a) => a.platform !== "instagram");

  const caption = buildCaption(article as Record<string, unknown>);
  const slug = article.published_path
    ? String(article.published_path).split("/").pop()?.replace(/\.md$/, "")
    : null;
  const articleUrl = slug ? `${SITE_BASE}/posts/${slug}/` : null;
  const urlWarning = articleUrl && !(await isUrlLive(articleUrl))
    ? `Article URL is not yet live (GitHub Pages is still rebuilding). The link in the post will return a 404 until the site rebuilds (~2–3 min). URL: ${articleUrl}`
    : undefined;

  const title    = String(article.title_en ?? article.title_nl ?? "");
  const emoji    = String(article.article_emoji ?? "✨");
  const source   = String(article.source_name ?? "");
  const imageUrl = article.image_url ? String(article.image_url) : null;

  const results: Record<string, unknown> = {};
  const errors:  string[]                = [];

  let cardMediaUrl: string | null = null;
  if (instagramAccounts.length > 0) {
    try {
      console.log(`[post-social] Generating Instagram card for article ${id}: title="${title}", imageUrl=${imageUrl ?? "none"}`);
      const png = await generateInstagramCardOg({ title, emoji, source, imageUrl });
      console.log(`[post-social] Card PNG generated: ${(png.byteLength / 1024).toFixed(0)} KB, uploading to Post for Me…`);
      cardMediaUrl = await uploadCardToPostForMe(png);
      console.log(`[post-social] Card uploaded: ${cardMediaUrl}`);
    } catch (err) {
      const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
      console.error("[post-social] Card generation/upload failed:", msg);
      errors.push(`Instagram card: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (textAccounts.length > 0) {
    try {
      results.text = await postToPlatforms(textAccounts.map((a) => a.id), caption);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[post-social] Text post failed:", msg);
      errors.push(`Text platforms: ${msg}`);
    }
  }

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

  if (anySuccess) {
    await db.execute({
      sql:  "UPDATE articles SET social_posted_at = datetime('now') WHERE id = ?",
      args: [id],
    });
  }

  return {
    ok:            anySuccess,
    status:        anySuccess ? 200 : 500,
    results,
    platforms:     enabledAccounts.map((a) => a.platform),
    card_uploaded: !!cardMediaUrl,
    errors:        errors.length > 0 ? errors : undefined,
    warning:       urlWarning,
  };
}

export async function POST(request: Request) {
  const { id, platforms } = await request.json().catch(() => ({}));
  if (!id) return Response.json({ error: "Missing article id." }, { status: 400 });

  const r = await postArticleToSocial(Number(id), platforms);
  const { status, ...body } = r;
  return Response.json(body, { status });
}

