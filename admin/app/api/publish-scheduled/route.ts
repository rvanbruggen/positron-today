/**
 * Publish Scheduled Articles
 *
 * Finds all articles with status='scheduled' whose publish_date has arrived
 * (i.e. publish_date <= now) and publishes each one to GitHub.
 *
 * Designed to be called by an external scheduler (launchd, cron, Vercel Cron, etc.)
 * on a regular interval (e.g. every hour).
 *
 * GET  /api/publish-scheduled          — dry-run: returns articles due for publishing
 * POST /api/publish-scheduled          — actually publishes them
 */

import db from "@/lib/db";

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN!;
const GITHUB_REPO   = process.env.GITHUB_REPO!;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? "main";

// ─── Shared publish helpers (duplicated from publish/route.ts) ────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/-$/, "");
}

function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function generateMarkdown(article: Record<string, unknown>, tagNames: string[]): string {
  const title = String(article.title_en ?? article.title_nl ?? "Untitled");
  // For scheduled articles, use the scheduled publish_date (not the actual publish time)
  // so the article appears at the right position in the timeline.
  const rawDate = article.publish_date ?? article.published_at;
  const date = rawDate
    ? String(rawDate).slice(0, 19).replace(" ", "T")
    : new Date().toISOString().slice(0, 19);

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
    `layout: post.njk`,
    `---`,
    ``,
    String(article.summary_en ?? ""),
  ].join("\n");
}

async function commitToGitHub(path: string, content: string, message: string) {
  const encoded = Buffer.from(content).toString("base64");
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;

  let sha: string | undefined;
  const existing = await fetch(url, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (existing.ok) sha = (await existing.json()).sha;

  const body: Record<string, unknown> = { message, content: encoded, branch: GITHUB_BRANCH };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
}

// ─── GET — dry-run ────────────────────────────────────────────────────────────

export async function GET() {
  const result = await db.execute(`
    SELECT a.id, a.title_en, a.title_nl, a.publish_date, a.source_url, a.source_name
    FROM articles a
    WHERE a.status = 'scheduled'
      AND a.summary_en IS NOT NULL
      AND a.publish_date IS NOT NULL
      AND datetime(a.publish_date) <= datetime('now')
    ORDER BY a.publish_date ASC
  `);

  return Response.json({
    due: result.rows.length,
    articles: result.rows.map((r) => ({
      id: r.id,
      title: r.title_en ?? r.title_nl,
      publish_date: r.publish_date,
      source_name: r.source_name,
    })),
    now: new Date().toISOString(),
  });
}

// ─── POST — publish all due ───────────────────────────────────────────────────

export async function POST() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return Response.json(
      { error: "GITHUB_TOKEN and GITHUB_REPO must be set in .env.local" },
      { status: 500 }
    );
  }

  // Find all scheduled articles whose publish_date has arrived
  const dueResult = await db.execute(`
    SELECT a.*, r.source_pub_date, r.fetched_at
    FROM articles a
    LEFT JOIN raw_articles r ON a.raw_article_id = r.id
    WHERE a.status = 'scheduled'
      AND a.summary_en IS NOT NULL
      AND a.publish_date IS NOT NULL
      AND datetime(a.publish_date) <= datetime('now')
    ORDER BY a.publish_date ASC
  `);

  const due = dueResult.rows;

  if (due.length === 0) {
    return Response.json({ published: 0, message: "No articles due for publishing" });
  }

  const results: Array<{ id: number; title: string; ok: boolean; path?: string; error?: string }> = [];

  for (const article of due) {
    const id = Number(article.id);
    const title = String(article.title_en ?? article.title_nl ?? article.id);

    try {
      // Fetch tags for this article
      const tagsResult = await db.execute({
        sql: `SELECT t.name FROM article_tags at2
              JOIN topics t ON at2.tag_id = t.id
              WHERE at2.article_id = ?
              ORDER BY t.name ASC`,
        args: [id],
      });
      const tagNames = tagsResult.rows.map((r) => String(r.name));

      // Use publish_date for the filename date
      const dateStr = String(article.publish_date).slice(0, 10);
      const path: string = article.published_path
        ? String(article.published_path)
        : `site/src/posts/${dateStr}-${slugify(title)}.md`;

      const markdown = generateMarkdown(article as Record<string, unknown>, tagNames);
      const isRepublish = !!article.published_path;
      await commitToGitHub(
        path,
        markdown,
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
  const failed    = results.filter((r) => !r.ok).length;

  return Response.json({ published: succeeded, failed, results });
}
