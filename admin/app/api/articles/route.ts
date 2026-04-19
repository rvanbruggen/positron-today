import { NextRequest } from "next/server";
import db from "@/lib/db";
import { exportRejections } from "@/lib/export-rejections";
import {
  findDuplicateHint,
  normaliseTitleTokens,
  type DuplicateCandidate,
} from "@/lib/title-similarity";

// Delete the published markdown file from the GitHub Pages site.
// Best-effort: logs and swallows errors so the caller's DB update still lands.
// Returns whether a deletion commit was made.
async function deletePublishedFile(publishedPath: string, message: string): Promise<boolean> {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH ?? "main";
  if (!token || !repo) return false;
  try {
    const url = `https://api.github.com/repos/${repo}/contents/${publishedPath}`;
    const getRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!getRes.ok) return false;
    const { sha } = await getRes.json();
    const delRes = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, sha, branch }),
    });
    return delRes.ok;
  } catch (err) {
    console.error("GitHub file deletion failed:", err);
    return false;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "pending";

  const result = await db.execute({
    sql: `SELECT r.*, s.name as source_name, s.language as source_language
          FROM raw_articles r
          JOIN sources s ON r.source_id = s.id
          WHERE r.status = ?
          ORDER BY r.fetched_at DESC`,
    args: [status],
  });

  // For the Preview queue (status=pending), flag articles whose titles look
  // similar to something else already in the pipeline. Comparison is
  // same-language-only and uses a cheap Jaccard token overlap — see
  // lib/title-similarity.ts for the tuning.
  if (status !== "pending" || result.rows.length === 0) {
    return Response.json(result.rows);
  }

  // Pool: other pending raws + recent articles table entries (14-day window).
  // Recent-enough that a user still has them in working memory, old enough to
  // catch same-topic reposts a week later.
  const recentArticles = await db.execute(`
    SELECT a.id, a.title_en, a.title_nl, a.title_fr,
           a.status, a.published_at, a.source_name,
           s.language as source_language
    FROM articles a
    LEFT JOIN raw_articles r ON a.raw_article_id = r.id
    LEFT JOIN sources      s ON r.source_id      = s.id
    WHERE a.status IN ('draft', 'scheduled', 'published')
      AND (a.created_at   >= datetime('now', '-14 days')
        OR a.published_at >= datetime('now', '-14 days')
        OR a.publish_date >= datetime('now', '-14 days'))
  `);

  type Candidate = {
    id:           number;
    title:        string;
    source_name:  string;
    language:     string;
    origin:       "pending" | "draft" | "scheduled" | "published";
    published_at: string | null;
  };

  const pool: DuplicateCandidate<Candidate>[] = [];

  for (const r of result.rows) {
    const title = String(r.title ?? "").trim();
    if (!title) continue;
    pool.push({
      item: {
        id:           Number(r.id),
        title,
        source_name:  String(r.source_name ?? ""),
        language:     String(r.source_language ?? "en"),
        origin:       "pending",
        published_at: null,
      },
      tokens: normaliseTitleTokens(title),
    });
  }

  for (const a of recentArticles.rows) {
    const lang = String(a.source_language ?? "en");
    const title =
      lang === "nl" ? String(a.title_nl ?? a.title_en ?? a.title_fr ?? "") :
      lang === "fr" ? String(a.title_fr ?? a.title_en ?? a.title_nl ?? "") :
                      String(a.title_en ?? a.title_nl ?? a.title_fr ?? "");
    if (!title.trim()) continue;
    pool.push({
      item: {
        id:           Number(a.id),
        title,
        source_name:  String(a.source_name ?? ""),
        language:     lang,
        origin:       String(a.status) as Candidate["origin"],
        published_at: a.published_at ? String(a.published_at) : null,
      },
      tokens: normaliseTitleTokens(title),
    });
  }

  const annotated = result.rows.map((r) => {
    const id       = Number(r.id);
    const title    = String(r.title ?? "");
    const language = String(r.source_language ?? "en");
    const tokens   = normaliseTitleTokens(title);
    const hint = findDuplicateHint(tokens, pool, (c) => c.origin === "pending" && c.id === id
                                                    || c.language !== language);
    return {
      ...r,
      duplicate_of: hint
        ? {
            id:           hint.match.id,
            title:        hint.match.title,
            source_name:  hint.match.source_name,
            origin:       hint.match.origin,
            similarity:   Math.round(hint.similarity * 100) / 100,
            shared_tokens: hint.sharedTokens,
            published_at: hint.match.published_at,
          }
        : null,
    };
  });

  return Response.json(annotated);
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, status, publish_date, topic_id, tags, reset_to_draft, content, post_to_social_on_publish, featured } = body;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  // Content edit: update title/summary/emoji fields directly
  if (content !== undefined) {
    const { title_en, title_nl, title_fr, summary_en, summary_nl, summary_fr, article_emoji, featured: featuredFlag } = content;
    await db.execute({
      sql: `UPDATE articles SET
              title_en = ?, title_nl = ?, title_fr = ?,
              summary_en = ?, summary_nl = ?, summary_fr = ?,
              article_emoji = ?, featured = ?
            WHERE id = ?`,
      args: [title_en, title_nl, title_fr, summary_en, summary_nl, summary_fr, article_emoji, featuredFlag ? 1 : 0, id],
    });
    return Response.json({ ok: true });
  }

  // Reset a published article back to draft for re-summarisation.
  // Also remove the live markdown from the site — otherwise the article keeps
  // showing publicly while being "back in the queue" in admin.
  if (reset_to_draft) {
    const current = await db.execute({
      sql: "SELECT published_path FROM articles WHERE id = ?",
      args: [id],
    });
    const publishedPath = current.rows[0]?.published_path as string | null | undefined;

    let siteDeleted = false;
    if (publishedPath) {
      siteDeleted = await deletePublishedFile(publishedPath, `Revert post to draft: ${publishedPath}`);
    }

    await db.execute({
      sql: `UPDATE articles SET status = 'draft',
              title_en = NULL, title_nl = NULL, title_fr = NULL,
              summary_en = NULL, summary_nl = NULL, summary_fr = NULL,
              article_emoji = NULL, published_at = NULL,
              published_path = NULL
            WHERE id = ?`,
      args: [id],
    });
    return Response.json({ ok: true, siteDeleted, hadPublishedPath: !!publishedPath });
  }

  if (post_to_social_on_publish !== undefined) {
    await db.execute({
      sql: "UPDATE articles SET post_to_social_on_publish = ? WHERE id = ?",
      args: [post_to_social_on_publish ? 1 : 0, id],
    });
    return Response.json({ ok: true });
  }

  if (featured !== undefined) {
    await db.execute({
      sql: "UPDATE articles SET featured = ? WHERE id = ?",
      args: [featured ? 1 : 0, id],
    });
    return Response.json({ ok: true });
  }

  if (publish_date !== undefined) {
    await db.execute({
      sql: "UPDATE articles SET publish_date = ? WHERE id = ?",
      args: [publish_date, id],
    });
    return Response.json({ ok: true });
  }

  // Multi-tag update: replace all tags for this article
  if (tags !== undefined) {
    await db.execute({
      sql: "DELETE FROM article_tags WHERE article_id = ?",
      args: [id],
    });
    for (const tagId of (tags as number[])) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)",
        args: [id, tagId],
      });
    }
    return Response.json({ ok: true });
  }

  // Legacy single topic_id update (kept for backward compat)
  if (topic_id !== undefined) {
    await db.execute({
      sql: "UPDATE articles SET topic_id = ? WHERE id = ?",
      args: [topic_id === null ? null : Number(topic_id), id],
    });
    // Also mirror into article_tags
    if (topic_id !== null) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)",
        args: [id, topic_id],
      });
    }
    return Response.json({ ok: true });
  }

  if (!status) return Response.json({ error: "id and status required" }, { status: 400 });

  await db.execute({
    sql: "UPDATE raw_articles SET status = ? WHERE id = ?",
    args: [status, id],
  });

  // When approved, create a draft article record ready for summarisation.
  // When discarded by a human on the Preview page, also append to the rejection
  // log (with a dedicated "human-discarded" category) so the discard shows up
  // in the admin rejections view and public "What We Skip" export.
  if (status === "approved" || status === "discarded") {
    const rawResult = await db.execute({
      sql: `SELECT r.*, s.name as source_name
            FROM raw_articles r
            JOIN sources s ON r.source_id = s.id
            WHERE r.id = ?`,
      args: [id],
    });
    const raw = rawResult.rows[0];
    if (raw && status === "approved") {
      await db.execute({
        sql: `INSERT OR IGNORE INTO articles (raw_article_id, source_url, source_name, status, positivity_score)
              VALUES (?, ?, ?, 'draft', ?)`,
        args: [raw.id, raw.url, raw.source_name, raw.positivity_score ?? null],
      });
    }
    if (raw && status === "discarded") {
      const snippet = raw.content
        ? String(raw.content).replace(/\s+/g, " ").trim().slice(0, 500)
        : null;
      await db.execute({
        sql: `INSERT OR IGNORE INTO rejected_articles
                (source_id, source_name, url, title, snippet,
                 rejection_reason, rejection_category, source_pub_date)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          raw.source_id ?? null,
          raw.source_name ?? "",
          raw.url ?? "",
          raw.title ?? "",
          snippet,
          "Discarded on human review",
          "human-discarded",
          raw.source_pub_date ?? null,
        ],
      });
      // Keep the public rejection log in sync — fire and forget.
      exportRejections().catch((err) => console.error("[export-rejections]", err));
    }
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const publishedPath = searchParams.get("published_path");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  // If the article has a published_path, delete the file from GitHub too.
  // Failures are logged but don't block the DB row deletion.
  if (publishedPath) {
    await deletePublishedFile(publishedPath, `Remove post: ${publishedPath}`);
  }

  // article_tags rows cascade-delete automatically
  await db.execute({ sql: "DELETE FROM articles WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
