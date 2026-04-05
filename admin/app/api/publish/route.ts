import { NextRequest } from "next/server";
import db from "@/lib/db";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_REPO = process.env.GITHUB_REPO!; // e.g. "rikvanbruggen/positiviteiten"
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

function generateMarkdown(article: Record<string, unknown>): string {
  const title = String(article.title_en ?? article.title_nl ?? "Untitled");
  const date = article.publish_date
    ? String(article.publish_date).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const yaml = [
    `---`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `title_nl: "${String(article.title_nl ?? title).replace(/"/g, '\\"')}"`,
    `title_fr: "${String(article.title_fr ?? title).replace(/"/g, '\\"')}"`,
    `date: ${date}`,
    `source_url: "${String(article.source_url)}"`,
    `source_name: "${String(article.source_name).replace(/"/g, '\\"')}"`,
    `topic: "${String(article.topic_name ?? "").replace(/"/g, '\\"')}"`,
    `emoji: "${String(article.topic_emoji ?? "📰")}"`,
    `summary: "${String(article.summary_en ?? "").replace(/"/g, '\\"')}"`,
    `summary_nl: "${String(article.summary_nl ?? "").replace(/"/g, '\\"')}"`,
    `summary_fr: "${String(article.summary_fr ?? "").replace(/"/g, '\\"')}"`,
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
  console.log("GitHub PUT URL:", url);
  console.log("Branch:", GITHUB_BRANCH);
  console.log("Token prefix:", GITHUB_TOKEN?.slice(0, 15));

  // Check if file already exists (to get its SHA for updates)
  let sha: string | undefined;
  const existing = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });
  console.log("GET status:", existing.status);
  if (existing.ok) {
    const data = await existing.json();
    sha = data.sha;
  }

  const body: Record<string, unknown> = {
    message,
    content: encoded,
    branch: GITHUB_BRANCH,
  };
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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${err}`);
  }
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

    const result = await db.execute({
      sql: `SELECT a.*, t.name as topic_name, t.emoji as topic_emoji
            FROM articles a
            LEFT JOIN topics t ON a.topic_id = t.id
            WHERE a.id = ?`,
      args: [id],
    });
    const article = result.rows[0];
    if (!article) return Response.json({ error: "Article not found" }, { status: 404 });

    if (!article.summary_en) {
      return Response.json({ error: "Article has no summary - run Summarise first" }, { status: 400 });
    }

    const date = article.publish_date
      ? String(article.publish_date).slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const titleSlug = slugify(String(article.title_en ?? article.title_nl ?? String(article.id)));
    const filename = `${date}-${titleSlug}.md`;
    const path = `site/src/posts/${filename}`;

    const markdown = generateMarkdown(article as Record<string, unknown>);
    await commitToGitHub(path, markdown, `Add post: ${String(article.title_en ?? filename)}`);

    // Mark as published
    await db.execute({
      sql: "UPDATE articles SET status = 'published', published_at = datetime('now') WHERE id = ?",
      args: [id],
    });

    return Response.json({ ok: true, path });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Publish error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
