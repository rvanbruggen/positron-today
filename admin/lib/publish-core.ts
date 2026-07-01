/**
 * Publish core logic — extracted from the API route so both the
 * serverless endpoint and the unified self-hosted pipeline can call it.
 */

import db from "@/lib/db";
import { parseScheduleWallString } from "@/lib/schedule-time";

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN!;
const GITHUB_REPO   = process.env.GITHUB_REPO!;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? "main";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/-$/, "");
}

export function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function generateMarkdown(article: Record<string, unknown>, tagNames: string[]): string {
  const title = String(article.title_en ?? article.title_nl ?? "Untitled");
  const date = new Date().toISOString().slice(0, 19);

  const sourcePubDate = article.source_pub_date
    ? String(article.source_pub_date).slice(0, 10)
    : null;
  const fetchedDate = article.fetched_at
    ? String(article.fetched_at).slice(0, 10)
    : null;

  const primaryTag = tagNames[0] ?? "";
  const emoji = String(article.article_emoji ?? "📰");

  return [
    `---`,
    `title: ${yamlStr(title)}`,
    `title_nl: ${yamlStr(String(article.title_nl ?? title))}`,
    `title_fr: ${yamlStr(String(article.title_fr ?? title))}`,
    `date: ${date}`,
    ...(sourcePubDate ? [`source_pub_date: ${sourcePubDate}`] : []),
    ...(fetchedDate   ? [`fetched_date: ${fetchedDate}`]      : []),
    `source_url: ${yamlStr(String(article.source_url))}`,
    `source_name: ${yamlStr(String(article.source_name))}`,
    `topic: ${yamlStr(primaryTag)}`,
    `tags: ${JSON.stringify(tagNames)}`,
    `emoji: ${yamlStr(emoji)}`,
    `summary: ${yamlStr(String(article.summary_en ?? ""))}`,
    `summary_nl: ${yamlStr(String(article.summary_nl ?? ""))}`,
    `summary_fr: ${yamlStr(String(article.summary_fr ?? ""))}`,
    ...(article.image_url ? [`image_url: ${yamlStr(String(article.image_url))}`] : []),
    ...(Number(article.featured ?? 0) === 1 ? [`featured: true`] : []),
    `layout: post.njk`,
    `---`,
    ``,
    String(article.summary_en ?? ""),
  ].join("\n");
}

export async function commitToGitHub(path: string, content: string, message: string) {
  const encoded = Buffer.from(content).toString("base64");
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" };

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let sha: string | undefined;
    const existing = await fetch(url, { headers });
    if (existing.ok) sha = (await existing.json()).sha;

    const body: Record<string, unknown> = { message, content: encoded, branch: GITHUB_BRANCH };
    if (sha) body.sha = sha;

    const res = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) return;

    if (res.status === 409 && attempt < MAX_RETRIES - 1) {
      console.warn(`SHA conflict on attempt ${attempt + 1}, retrying…`);
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }

    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }
}

export async function deleteFromGitHub(path: string, message: string) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" };

  const existing = await fetch(url, { headers });
  if (!existing.ok) return;

  const { sha } = await existing.json();
  const res = await fetch(url, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha, branch: GITHUB_BRANCH }),
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`GitHub delete error ${res.status}: ${await res.text()}`);
  }
}

/**
 * Re-commit the markdown for an already-published article so frontmatter
 * changes (e.g. the `featured` flag flipping the wide-card layout) reach the
 * live site without waiting for a manual republish.
 *
 * No-op for articles that have never been published (no `published_path`),
 * so callers can fire it unconditionally after a flag change.
 */
export async function republishArticle(id: number): Promise<boolean> {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return false;

  const articleResult = await db.execute({
    sql: `SELECT a.*, r.source_pub_date, r.fetched_at
          FROM articles a
          LEFT JOIN raw_articles r ON a.raw_article_id = r.id
          WHERE a.id = ?`,
    args: [id],
  });
  const article = articleResult.rows[0];
  if (!article || !article.published_path) return false;

  const tagsResult = await db.execute({
    sql: `SELECT t.name FROM article_tags at2
          JOIN topics t ON at2.tag_id = t.id
          WHERE at2.article_id = ?
          ORDER BY t.name ASC`,
    args: [id],
  });
  const tagNames = tagsResult.rows.map((r) => String(r.name));

  const path = String(article.published_path);
  const title = String(article.title_en ?? article.title_nl ?? path);
  const markdown = generateMarkdown(article as Record<string, unknown>, tagNames);
  await commitToGitHub(path, markdown, `Update post: ${title}`);
  return true;
}

// ─── Main publish logic ──────────────────────────────────────────────────────

export interface PublishResult {
  published: number;
  failed: number;
  results: Array<{ id: number; title: string; ok: boolean; path?: string; error?: string }>;
  error?: string;
}

export async function publishScheduledArticles(): Promise<PublishResult> {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return { published: 0, failed: 0, results: [], error: "GITHUB_TOKEN and GITHUB_REPO must be set" };
  }

  const allScheduled = await db.execute(`
    SELECT a.*, r.source_pub_date, r.fetched_at
    FROM articles a
    LEFT JOIN raw_articles r ON a.raw_article_id = r.id
    WHERE a.status = 'scheduled'
      AND a.summary_en IS NOT NULL
      AND a.publish_date IS NOT NULL
    ORDER BY a.publish_date ASC
  `);

  const now = new Date();
  const due = allScheduled.rows.filter((r) => {
    const publishAt = parseScheduleWallString(String(r.publish_date));
    return publishAt <= now;
  });

  if (due.length === 0) {
    return { published: 0, failed: 0, results: [] };
  }

  const results: Array<{ id: number; title: string; ok: boolean; path?: string; error?: string }> = [];

  for (const article of due) {
    const id = Number(article.id);
    const title = String(article.title_en ?? article.title_nl ?? article.id);

    try {
      const tagsResult = await db.execute({
        sql: `SELECT t.name FROM article_tags at2
              JOIN topics t ON at2.tag_id = t.id
              WHERE at2.article_id = ?
              ORDER BY t.name ASC`,
        args: [id],
      });
      const tagNames = tagsResult.rows.map((r) => String(r.name));

      const dateStr = new Date().toISOString().slice(0, 10);
      const path: string = article.published_path
        ? String(article.published_path)
        : `site/src/posts/${dateStr}-${slugify(title)}.md`;

      const markdown = generateMarkdown(article as Record<string, unknown>, tagNames);
      const isRepublish = !!article.published_path;
      await commitToGitHub(
        path, markdown,
        isRepublish ? `Update post: ${title}` : `Add post: ${title}`,
      );

      await db.execute({
        sql: "UPDATE articles SET status = 'published', published_at = datetime('now'), published_path = ? WHERE id = ?",
        args: [path, id],
      });

      results.push({ id, title, ok: true, path });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[publish-scheduled] Failed to publish article ${id}:`, message);
      results.push({ id, title, ok: false, error: message });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return { published: succeeded, failed, results };
}
