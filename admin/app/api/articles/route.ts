import { NextRequest } from "next/server";
import db from "@/lib/db";
import { exportRejections } from "@/lib/export-rejections";
import {
  findDuplicateHint,
  normaliseTitleTokens,
  type DuplicateCandidate,
} from "@/lib/title-similarity";
import { isNativeOutputLanguage } from "@/lib/languages";

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
  //
  // Sources whose input language is NOT en/nl/fr (Spanish, German, "auto",
  // etc.) get an English preview translation at fetch time. We use that
  // preview to dedup them in English space — so a Spanish article and an
  // English article about the same event will still match each other.
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

  // Pool building rules:
  //   - en/nl/fr pending raws → one entry in their native language.
  //   - non-native pending raws WITH an English preview translation →
  //     one entry tagged language="en" using the preview tokens, so they
  //     can match (and be matched by) any English-comparable article.
  //   - non-native pending raws WITHOUT a preview → not in pool, not annotated.
  //   - recent articles (en/nl/fr) → entry in their native language. If the
  //     source language is not English, ALSO add an "en" entry from
  //     title_en so non-native pending raws can match against them via English.
  for (const r of result.rows) {
    const lang        = String(r.source_language ?? "en");
    const nativeTitle = String(r.title ?? "").trim();
    const previewEn   = String(r.preview_title_en ?? "").trim();

    if (isNativeOutputLanguage(lang) && nativeTitle) {
      pool.push({
        item: {
          id:           Number(r.id),
          title:        nativeTitle,
          source_name:  String(r.source_name ?? ""),
          language:     lang,
          origin:       "pending",
          published_at: null,
        },
        tokens: normaliseTitleTokens(nativeTitle),
      });
    } else if (!isNativeOutputLanguage(lang) && previewEn) {
      pool.push({
        item: {
          id:           Number(r.id),
          // Show the preview text in the duplicate hint so the reviewer
          // sees why the match fired (it's the English rendering, not the
          // original-language title).
          title:        previewEn,
          source_name:  String(r.source_name ?? ""),
          language:     "en",
          origin:       "pending",
          published_at: null,
        },
        tokens: normaliseTitleTokens(previewEn),
      });
    }
  }

  for (const a of recentArticles.rows) {
    const lang = String(a.source_language ?? "en");
    if (!isNativeOutputLanguage(lang)) continue;
    const nativeTitle =
      lang === "nl" ? String(a.title_nl ?? a.title_en ?? a.title_fr ?? "") :
      lang === "fr" ? String(a.title_fr ?? a.title_en ?? a.title_nl ?? "") :
                      String(a.title_en ?? a.title_nl ?? a.title_fr ?? "");
    if (nativeTitle.trim()) {
      pool.push({
        item: {
          id:           Number(a.id),
          title:        nativeTitle,
          source_name:  String(a.source_name ?? ""),
          language:     lang,
          origin:       String(a.status) as Candidate["origin"],
          published_at: a.published_at ? String(a.published_at) : null,
        },
        tokens: normaliseTitleTokens(nativeTitle),
      });
    }

    // For nl/fr-language recent articles, add an English-side entry too so
    // non-native pending raws (matched in English space) can find them.
    // Skip when source is already English to avoid a duplicate copy.
    const titleEn = String(a.title_en ?? "").trim();
    if (lang !== "en" && titleEn) {
      pool.push({
        item: {
          id:           Number(a.id),
          title:        titleEn,
          source_name:  String(a.source_name ?? ""),
          language:     "en",
          origin:       String(a.status) as Candidate["origin"],
          published_at: a.published_at ? String(a.published_at) : null,
        },
        tokens: normaliseTitleTokens(titleEn),
      });
    }
  }

  const annotated = result.rows.map((r) => {
    const id       = Number(r.id);
    const language = String(r.source_language ?? "en");
    const nativeTitle = String(r.title ?? "");
    const previewEn   = String(r.preview_title_en ?? "").trim();

    // Pick the comparison title + language. Native rows compare in their own
    // language; non-native rows with a preview compare in English.
    let compareTokens: Set<string>;
    let compareLang:   string;
    if (isNativeOutputLanguage(language) && nativeTitle) {
      compareTokens = normaliseTitleTokens(nativeTitle);
      compareLang   = language;
    } else if (!isNativeOutputLanguage(language) && previewEn) {
      compareTokens = normaliseTitleTokens(previewEn);
      compareLang   = "en";
    } else {
      return { ...r, duplicate_of: null };
    }

    const hint = findDuplicateHint(compareTokens, pool, (c) => c.origin === "pending" && c.id === id
                                                            || c.language !== compareLang);
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

  return Response.json(await groupByStory(annotated as unknown as Row[]));
}

type Row = Record<string, unknown>;

/**
 * Story folding (see lib/story-fold.ts): return one entry per story instead of
 * one per article. The earliest queued article leads the card; the story's
 * other queued articles ride along in `story_versions`, and `story_state` says
 * what already happened to the story on review:
 *   open     - nothing decided yet
 *   skipped  - an earlier version was discarded on review
 *   approved - an earlier version was approved (normally filed away by the
 *              pipeline already; this covers approvals made since the last run)
 * Articles not matched to a story yet are each their own story.
 */
async function groupByStory(rows: Row[]) {
  const storyOf = (r: Row) => Number(r.story_id ?? r.id);
  const groups = new Map<number, Row[]>();
  for (const r of rows) {
    const k = storyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  // What happened to each story's earlier articles. Only human decisions count:
  // rows the pipeline filed away itself carry a fold_reason.
  const history = new Map<number, { approved: number; skipped: number; latest: string | null }>();
  const matched = [...groups.keys()].filter((k) => rows.some((r) => r.story_id != null && storyOf(r) === k));
  if (matched.length) {
    const res = await db.execute(
      `SELECT story_id, status, COALESCE(preview_title_en, title) AS title
       FROM raw_articles
       WHERE story_id IN (${matched.join(",")}) AND status != 'pending' AND fold_reason IS NULL
       ORDER BY id DESC`,
    );
    for (const h of res.rows) {
      const k = Number(h.story_id);
      const e = history.get(k) ?? { approved: 0, skipped: 0, latest: null };
      if (h.status === "approved") e.approved++; else e.skipped++;
      e.latest ??= String(h.title ?? "");
      history.set(k, e);
    }
  }

  const cards = [...groups.entries()].map(([k, members]) => {
    members.sort((a, b) => Number(a.id) - Number(b.id));
    const lead: Row = members[0];
    const rest = members.slice(1);
    const h = history.get(k);
    return {
      ...lead,
      story_id: k,
      story_state: h?.approved ? "approved" : h?.skipped ? "skipped" : "open",
      story_history: h ?? null,
      story_versions: rest.map((v) => ({
        id: v.id, title: v.title, url: v.url, source_name: v.source_name,
        source_language: v.source_language, preview_title_en: v.preview_title_en,
      })),
    };
  });
  // Newest story first, matching the old per-article order.
  const when = (c: Row) => String(c.fetched_at ?? "");
  return cards.sort((a, b) => when(b).localeCompare(when(a)));
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, status, publish_date, topic_id, tags, reset_to_draft, content, post_to_social_on_publish, featured, digest_pick } = body;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  // Content edit: update title/summary/emoji fields directly
  if (content !== undefined) {
    const {
      title_en, title_nl, title_fr, summary_en, summary_nl, summary_fr, article_emoji,
      featured: featuredFlag, digest_pick: digestPickFlag,
      post_to_social_on_publish: socialFlag,
      post_to_substack: substackFlag,
    } = content;
    // socialFlag / substackFlag are omitted for already-published articles
    // (History modal), where the announce-on-publish flags are moot —
    // COALESCE keeps the stored value instead of clobbering it to 0.
    const socialArg = socialFlag === undefined ? null : (socialFlag ? 1 : 0);
    const substackArg = substackFlag === undefined ? null : (substackFlag ? 1 : 0);
    await db.execute({
      sql: `UPDATE articles SET
              title_en = ?, title_nl = ?, title_fr = ?,
              summary_en = ?, summary_nl = ?, summary_fr = ?,
              article_emoji = ?, featured = ?, digest_pick = ?,
              post_to_social_on_publish = COALESCE(?, post_to_social_on_publish),
              post_to_substack = COALESCE(?, post_to_substack)
            WHERE id = ?`,
      args: [title_en, title_nl, title_fr, summary_en, summary_nl, summary_fr, article_emoji, featuredFlag ? 1 : 0, digestPickFlag ? 1 : 0, socialArg, substackArg, id],
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

  if (digest_pick !== undefined) {
    // Digest inclusion and wider-column promotion move together on the one-tap
    // button: picking an article for the digest also features it (wide card),
    // and un-picking removes both. The Edit modal still sets `featured` and
    // `digest_pick` independently for the rare article that should be one but
    // not the other.
    const flag = digest_pick ? 1 : 0;
    await db.execute({
      sql: "UPDATE articles SET digest_pick = ?, featured = ? WHERE id = ?",
      args: [flag, flag, id],
    });
    if (digest_pick) {
      const { postPendingSubstack } = await import("@/lib/substack");
      postPendingSubstack().catch((err) =>
        console.error("[articles] Substack auto-post after digest pick failed:", err)
      );
    }
    // If the article is already published, re-commit so the featured change
    // reaches the live site immediately. No-op for not-yet-published articles,
    // where the flag is applied at publish time.
    try {
      const { republishArticle } = await import("@/lib/publish-core");
      await republishArticle(Number(id));
    } catch (err) {
      console.error("[articles] republish after digest/featured toggle failed:", err);
    }
    return Response.json({ ok: true, featured: !!flag });
  }

  if (publish_date !== undefined) {
    await db.execute({
      sql: "UPDATE articles SET publish_date = ? WHERE id = ?",
      args: [publish_date, id],
    });
    try {
      if (publish_date) {
        const { scheduleArticle } = await import("@/lib/publish-timer");
        scheduleArticle(id, publish_date);
      } else {
        const { cancelArticle } = await import("@/lib/publish-timer");
        cancelArticle(id);
      }
    } catch { /* scheduler may not be running */ }
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
  // in the admin rejections view and public "What gets skipped" export.
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

    // Story folding: one decision settles the whole card. The story's other
    // queued versions are filed away with a fold_reason and NOT written to the
    // rejection log - the human decision above was recorded once, already.
    if (raw && raw.story_id != null) {
      await db.execute({
        sql: `UPDATE raw_articles SET status = 'discarded', fold_reason = ?
              WHERE story_id = ? AND id != ? AND status = 'pending'`,
        args: [status === "approved" ? "sibling_approved" : "story_discarded", raw.story_id, id],
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
