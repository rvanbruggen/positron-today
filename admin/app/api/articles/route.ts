import { NextRequest } from "next/server";
import db from "@/lib/db";

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
    sql: `SELECT r.*, s.name as source_name
          FROM raw_articles r
          JOIN sources s ON r.source_id = s.id
          WHERE r.status = ?
          ORDER BY r.fetched_at DESC`,
    args: [status],
  });
  return Response.json(result.rows);
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

  // When approved, create a draft article record ready for summarisation
  if (status === "approved") {
    const rawResult = await db.execute({
      sql: `SELECT r.*, s.name as source_name
            FROM raw_articles r
            JOIN sources s ON r.source_id = s.id
            WHERE r.id = ?`,
      args: [id],
    });
    const raw = rawResult.rows[0];
    if (raw) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO articles (raw_article_id, source_url, source_name, status, positivity_score)
              VALUES (?, ?, ?, 'draft', ?)`,
        args: [raw.id, raw.url, raw.source_name, raw.positivity_score ?? null],
      });
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
