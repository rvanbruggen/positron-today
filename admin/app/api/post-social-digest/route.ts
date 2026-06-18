/**
 * POST /api/post-social-digest
 *
 * Posts a digest (3–5 hand-picked articles) to all enabled social platforms.
 * Generates a scattered polaroid collage image and a summary caption with hashtags.
 *
 * Query params:
 *   ?manual=1  — admin-triggered (no Bearer token required)
 *   ?dry_run=1 — generate collage + caption but don't post
 */

export const dynamic = "force-dynamic";

import db from "@/lib/db";
import {
  generateDigestCollage,
  MIN_DIGEST_ARTICLES,
  type DigestArticle,
} from "@/lib/digest-collage";
import { buildDigestCaption, buildInstagramDigestCaption, type DigestCaptionArticle } from "@/lib/digest-caption";
import { fetchDigestArticles, runDigest } from "@/lib/digest-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const preview = url.searchParams.get("preview");

  if (preview === "image") {
    const { articles } = await fetchDigestArticles();
    if (articles.length < MIN_DIGEST_ARTICLES) {
      return Response.json({ error: `Need at least ${MIN_DIGEST_ARTICLES} digest picks, found ${articles.length}` }, { status: 400 });
    }
    const digestArticles: DigestArticle[] = articles.map((a) => ({
      title: a.title_en ?? a.title_nl ?? "",
      emoji: a.article_emoji ?? "✨",
      imageUrl: a.image_url,
    }));
    const png = await generateDigestCollage(digestArticles);
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  }

  if (preview === "caption") {
    const { articles, tags } = await fetchDigestArticles();
    if (articles.length < MIN_DIGEST_ARTICLES) {
      return Response.json({ error: `Need at least ${MIN_DIGEST_ARTICLES} digest picks, found ${articles.length}` }, { status: 400 });
    }
    const captionArticles: DigestCaptionArticle[] = articles.map((a) => ({
      emoji: a.article_emoji ?? "✨",
      title: a.title_en ?? a.title_nl ?? "",
      tags: tags.get(a.id) ?? [],
    }));
    return Response.json({
      caption: await buildDigestCaption(captionArticles),
      instagram_caption: buildInstagramDigestCaption(captionArticles),
      articles: articles.map((a) => ({ id: a.id, title: a.title_en ?? a.title_nl })),
    });
  }

  const result = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM articles
          WHERE digest_pick = 1 AND digest_posted_at IS NULL AND status = 'published'`,
    args: [],
  });
  const pending = Number(result.rows[0]?.cnt ?? 0);
  return Response.json({ pending });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const isManual = url.searchParams.get("manual") === "1";

  // Dry-run: generate collage + caption without posting
  if (dryRun) {
    const { articles, tags } = await fetchDigestArticles();
    if (articles.length < MIN_DIGEST_ARTICLES) {
      return Response.json({
        ok: false,
        error: `Need at least ${MIN_DIGEST_ARTICLES} articles with digest_pick=1, found ${articles.length}.`,
        pending: articles.length,
      }, { status: 400 });
    }
    const digestArticles: DigestArticle[] = articles.map((a) => ({
      title: a.title_en ?? a.title_nl ?? "",
      emoji: a.article_emoji ?? "✨",
      imageUrl: a.image_url,
    }));
    const captionArticles = articles.map((a) => ({
      emoji: a.article_emoji ?? "✨",
      title: a.title_en ?? a.title_nl ?? "",
      tags: tags.get(a.id) ?? [],
    }));
    const collagePng = await generateDigestCollage(digestArticles);
    const caption = await buildDigestCaption(captionArticles);
    const instagramCaption = buildInstagramDigestCaption(captionArticles);
    return Response.json({
      ok: true, dry_run: true,
      articles: articles.map((a) => ({ id: a.id, title: a.title_en ?? a.title_nl })),
      caption, instagram_caption: instagramCaption,
      collage_size_kb: Math.round(collagePng.byteLength / 1024),
    });
  }

  const result = await runDigest({ isManual });
  return Response.json(result, { status: result.ok ? 200 : result.error ? 500 : 200 });
}
