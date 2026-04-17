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
import { postArticleToSocial } from "@/app/api/post-social/route";

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN!;
const GITHUB_REPO   = process.env.GITHUB_REPO!;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? "main";
const SITE_BASE     = "https://positron.today";

async function waitForUrlLive(url: string, maxWaitMs = 180_000, intervalMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "follow" });
      if (res.ok) return true;
    } catch { /* not live yet */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

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
  // Fetch all scheduled articles with a publish_date and filter in JS
  // to avoid SQLite treating stored local times as UTC (timezone bug).
  const result = await db.execute(`
    SELECT a.id, a.title_en, a.title_nl, a.publish_date, a.source_url, a.source_name
    FROM articles a
    WHERE a.status = 'scheduled'
      AND a.summary_en IS NOT NULL
      AND a.publish_date IS NOT NULL
    ORDER BY a.publish_date ASC
  `);

  const now = new Date();
  const due = result.rows.filter((r) => {
    const pd = String(r.publish_date);
    // Stored as local ISO (YYYY-MM-DDTHH:MM:SS) — parse as local time
    const publishAt = new Date(pd.includes("T") ? pd : pd.replace(" ", "T"));
    return publishAt <= now;
  });

  return Response.json({
    due: due.length,
    articles: due.map((r) => ({
      id: r.id,
      title: r.title_en ?? r.title_nl,
      publish_date: r.publish_date,
      source_name: r.source_name,
    })),
    now: now.toISOString(),
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

  // Find all scheduled articles with a publish_date, then filter in JS
  // to avoid SQLite treating stored local times as UTC (timezone bug).
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
    const pd = String(r.publish_date);
    // Stored as local ISO (YYYY-MM-DDTHH:MM:SS) — parse as local time
    const publishAt = new Date(pd.includes("T") ? pd : pd.replace(" ", "T"));
    return publishAt <= now;
  });

  if (due.length === 0) {
    return Response.json({ published: 0, message: "No articles due for publishing" });
  }

  const results: Array<{ id: number; title: string; ok: boolean; path?: string; error?: string; social?: unknown }> = [];

  // ── Phase 1: publish all due articles to GitHub ───────────────────────────
  const needsSocial: Array<{ id: number; path: string }> = [];

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
        path,
        markdown,
        isRepublish ? `Update post: ${title}` : `Add post: ${title}`,
      );

      await db.execute({
        sql: "UPDATE articles SET status = 'published', published_at = datetime('now'), published_path = ? WHERE id = ?",
        args: [path, id],
      });

      results.push({ id, title, ok: true, path });

      if (Number(article.post_to_social_on_publish ?? 0) === 1) {
        needsSocial.push({ id, path });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[publish-scheduled] Failed to publish article ${id}:`, message);
      results.push({ id, title, ok: false, error: message });
    }
  }

  // ── Phase 2: wait for GitHub Pages rebuild, then post to social ───────────
  if (needsSocial.length > 0) {
    const firstUrl = `${SITE_BASE}/posts/${needsSocial[0].path.split("/").pop()?.replace(/\.md$/, "")}/`;
    console.log(`[publish-scheduled] Waiting for GitHub Pages rebuild… checking ${firstUrl}`);
    await waitForUrlLive(firstUrl);

    for (const { id } of needsSocial) {
      const r = results.find((x) => x.id === id);
      try {
        const social = await postArticleToSocial(id);
        if (r) r.social = social;
      } catch (err) {
        const socialErr = { ok: false, error: err instanceof Error ? err.message : String(err) };
        if (r) r.social = socialErr;
        console.error(`[publish-scheduled] id=${id} social error:`, err);
      }
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed    = results.filter((r) => !r.ok).length;

  return Response.json({ published: succeeded, failed, results });
}
