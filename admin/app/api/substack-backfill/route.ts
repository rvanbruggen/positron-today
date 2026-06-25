import { NextRequest } from "next/server";
import { SubstackClient } from "substack-api";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

const SITE_BASE = "https://positron.today";
const PUBLICATION_URL = "https://positrontoday.substack.com";

function buildFullBodyJson(article: Record<string, unknown>) {
  const emoji = String(article.article_emoji ?? "✨");
  const summary = String(article.summary_en ?? "");
  const sourceUrl = String(article.source_url ?? "");
  const sourceName = String(article.source_name ?? "");

  const slug = article.published_path
    ? String(article.published_path).split("/").pop()?.replace(/\.md$/, "")
    : null;
  const siteUrl = slug ? `${SITE_BASE}/posts/${slug}/` : SITE_BASE;

  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: summary }],
      },
      { type: "horizontal_rule" },
      {
        type: "paragraph",
        content: [
          { type: "text", text: `${emoji} ` },
          {
            type: "text",
            marks: [{ type: "link", attrs: { href: sourceUrl } }],
            text: `Read the original article on ${sourceName} ↗`,
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            marks: [{ type: "link", attrs: { href: siteUrl } }],
            text: "See this article on Positron.today ↗",
          },
        ],
      },
    ],
  };
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get("dry") === "1";

  const sid = process.env.SUBSTACK_SID;
  if (!sid) return Response.json({ error: "SUBSTACK_SID is not set" }, { status: 500 });

  const cookie = `substack.sid=${sid}`;

  // 1. Fetch all published articles from our DB
  const articlesResult = await db.execute(`
    SELECT id, title_en, title_nl, title_fr, summary_en, source_url, source_name,
           article_emoji, image_url, published_path
    FROM articles
    WHERE status = 'published'
    ORDER BY published_at DESC
  `);
  const articles = articlesResult.rows;

  // 2. Fetch all posts from Substack via the API
  const client = new SubstackClient({ publicationUrl: PUBLICATION_URL, token: sid });
  const profile = await client.ownProfile();

  const substackPosts: Array<{ id: number; title: string }> = [];
  for await (const post of profile.posts({ limit: 500 })) {
    substackPosts.push({ id: post.id, title: post.title });
  }

  // 3. Match by normalised title
  const results: Array<{
    substackId: number;
    substackTitle: string;
    articleId: number;
    articleTitle: string;
    updated: boolean;
    error?: string;
  }> = [];

  for (const sp of substackPosts) {
    const normSp = normalise(sp.title);
    const match = articles.find((a) => {
      const titleEn = a.title_en ? normalise(String(a.title_en)) : "";
      const titleNl = a.title_nl ? normalise(String(a.title_nl)) : "";
      const titleFr = a.title_fr ? normalise(String(a.title_fr)) : "";
      return (titleEn && titleEn === normSp) ||
             (titleNl && titleNl === normSp) ||
             (titleFr && titleFr === normSp);
    });

    if (!match) continue;

    const articleTitle = String(match.title_en ?? match.title_nl ?? "");
    const imageUrl = match.image_url ? String(match.image_url) : null;
    const bodyJson = buildFullBodyJson(match as Record<string, unknown>);

    const slug = match.published_path
      ? String(match.published_path).split("/").pop()?.replace(/\.md$/, "")
      : null;
    const siteUrl = slug ? `${SITE_BASE}/posts/${slug}/` : SITE_BASE;
    const subtitle = `Read on Positron.today: ${siteUrl}`;

    if (dryRun) {
      results.push({
        substackId: sp.id,
        substackTitle: sp.title,
        articleId: Number(match.id),
        articleTitle,
        updated: false,
      });
      continue;
    }

    // Replace the full body with a properly structured ProseMirror document
    try {
      const updatePayload: Record<string, unknown> = {
        draft_body: JSON.stringify(bodyJson),
        draft_subtitle: subtitle,
      };
      if (imageUrl) updatePayload.cover_image = imageUrl;

      const updateRes = await fetch(`${PUBLICATION_URL}/api/v1/drafts/${sp.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify(updatePayload),
      });

      if (!updateRes.ok) {
        const text = await updateRes.text();
        results.push({
          substackId: sp.id,
          substackTitle: sp.title,
          articleId: Number(match.id),
          articleTitle,
          updated: false,
          error: `Update failed ${updateRes.status}: ${text.slice(0, 200)}`,
        });
        continue;
      }

      // Re-publish to push draft changes live
      const pubRes = await fetch(`${PUBLICATION_URL}/api/v1/drafts/${sp.id}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({}),
      });

      if (!pubRes.ok) {
        const text = await pubRes.text();
        results.push({
          substackId: sp.id,
          substackTitle: sp.title,
          articleId: Number(match.id),
          articleTitle,
          updated: false,
          error: `Re-publish failed ${pubRes.status}: ${text.slice(0, 200)}`,
        });
      } else {
        results.push({
          substackId: sp.id,
          substackTitle: sp.title,
          articleId: Number(match.id),
          articleTitle,
          updated: true,
        });
      }
    } catch (err) {
      results.push({
        substackId: sp.id,
        substackTitle: sp.title,
        articleId: Number(match.id),
        articleTitle,
        updated: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const matched = results.length;
  const updated = results.filter((r) => r.updated).length;
  const unmatched = substackPosts.length - matched;

  return Response.json({
    dryRun,
    totalSubstackPosts: substackPosts.length,
    totalArticles: articles.length,
    matched,
    updated,
    unmatched,
    results,
  });
}
