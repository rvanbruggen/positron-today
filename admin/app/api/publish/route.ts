import { NextRequest } from "next/server";
import db from "@/lib/db";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_REPO = process.env.GITHUB_REPO!;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? "main";

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
  // Keep full ISO datetime so Eleventy can sort multiple same-day posts correctly.
  // Use published_at (has time component) if available, otherwise now.
  // Eleventy accepts "YYYY-MM-DDTHH:MM:SS" in front matter date fields.
  const rawDate = article.published_at ?? article.publish_date;
  const date = rawDate
    ? String(rawDate).slice(0, 19).replace(" ", "T")
    : new Date().toISOString().slice(0, 19);

  // Original source publication date (from RSS isoDate/pubDate), if captured
  const sourcePubDate = article.source_pub_date
    ? String(article.source_pub_date).slice(0, 10)
    : null;

  // Date we fetched this article from the RSS feed
  const fetchedDate = article.fetched_at
    ? String(article.fetched_at).slice(0, 10)
    : null;

  // Primary tag for backward compat (post template still reads `topic`)
  const primaryTag = tagNames[0] ?? "";
  // Per-article emoji from Claude, fallback to 📰
  const emoji = String(article.article_emoji ?? "📰");

  const yaml = [
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

  return yaml;
}

async function commitToGitHub(path: string, content: string, message: string) {
  const encoded = Buffer.from(content).toString("base64");
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  console.log("GitHub PUT URL:", url, "| Branch:", GITHUB_BRANCH);

  let sha: string | undefined;
  const existing = await fetch(url, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  console.log("GET status:", existing.status);
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

export async function POST(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    if (!GITHUB_TOKEN || !GITHUB_REPO) {
      return Response.json(
        { error: "GITHUB_TOKEN and GITHUB_REPO must be set in .env.local" },
        { status: 500 }
      );
    }

    // Fetch article + all its tags via the join table
    // JOIN raw_articles to pick up source_pub_date (original RSS publication date)
    const [articleResult, tagsResult] = await Promise.all([
      db.execute({
        sql: `SELECT a.*, r.source_pub_date, r.fetched_at
              FROM articles a
              LEFT JOIN raw_articles r ON a.raw_article_id = r.id
              WHERE a.id = ?`,
        args: [id],
      }),
      db.execute({
        sql: `SELECT t.name FROM article_tags at2
              JOIN topics t ON at2.tag_id = t.id
              WHERE at2.article_id = ?
              ORDER BY t.name ASC`,
        args: [id],
      }),
    ]);

    const article = articleResult.rows[0];
    if (!article) return Response.json({ error: "Article not found" }, { status: 404 });
    if (!article.summary_en) {
      return Response.json({ error: "Article has no summary - run Summarise first" }, { status: 400 });
    }

    const tagNames = tagsResult.rows.map((r) => String(r.name));

    // Date portion only (YYYY-MM-DD) used for the filename
    const rawDate = article.published_at ?? article.publish_date;
    const date = rawDate
      ? String(rawDate).slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    // Reuse the path from the first publish so re-publishing always overwrites
    // the same file rather than creating a duplicate with a slightly different slug.
    const path: string = article.published_path
      ? String(article.published_path)
      : `site/src/posts/${date}-${slugify(String(article.title_en ?? article.title_nl ?? String(article.id)))}.md`;

    const markdown = generateMarkdown(article as Record<string, unknown>, tagNames);
    const isRepublish = !!article.published_path;
    await commitToGitHub(
      path,
      markdown,
      isRepublish
        ? `Update post: ${String(article.title_en ?? path)}`
        : `Add post: ${String(article.title_en ?? path)}`
    );

    await db.execute({
      sql: "UPDATE articles SET status = 'published', published_at = datetime('now'), published_path = ? WHERE id = ?",
      args: [path, id],
    });

    return Response.json({ ok: true, path });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Publish error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
