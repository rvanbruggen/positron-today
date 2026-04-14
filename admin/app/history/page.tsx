export const dynamic = "force-dynamic";

import db from "@/lib/db";
import HistoryClient from "./HistoryClient";

function parseTagData(raw: unknown): { id: number; name: string; emoji: string }[] {
  if (!raw) return [];
  return String(raw).split("~~").filter(Boolean).map((s) => {
    const [id, name, emoji] = s.split("|");
    return { id: Number(id), name: name ?? "", emoji: emoji ?? "📰" };
  });
}

export default async function HistoryPage() {
  const [articlesResult, tagsResult] = await Promise.all([
    db.execute(`
      SELECT a.id, a.title_en, a.title_nl, a.title_fr,
             a.summary_en, a.summary_nl, a.summary_fr,
             a.source_url, a.source_name, a.image_url,
             a.article_emoji, a.published_at, a.publish_date, a.published_path,
             a.social_posted_at,
             r.source_pub_date,
             (SELECT GROUP_CONCAT(t.id || '|' || t.name || '|' || t.emoji, '~~')
              FROM article_tags at2
              JOIN topics t ON at2.tag_id = t.id
              WHERE at2.article_id = a.id) as tag_data
      FROM articles a
      LEFT JOIN raw_articles r ON a.raw_article_id = r.id
      WHERE a.status = 'published'
      ORDER BY a.published_at DESC
    `),
    db.execute("SELECT id, name, emoji FROM topics ORDER BY name ASC"),
  ]);

  const articles = articlesResult.rows.map((a) => ({
    id: Number(a.id),
    title_en: a.title_en ? String(a.title_en) : null,
    title_nl: a.title_nl ? String(a.title_nl) : null,
    title_fr: a.title_fr ? String(a.title_fr) : null,
    summary_en: a.summary_en ? String(a.summary_en) : null,
    summary_nl: a.summary_nl ? String(a.summary_nl) : null,
    summary_fr: a.summary_fr ? String(a.summary_fr) : null,
    source_url: String(a.source_url),
    source_name: String(a.source_name),
    article_emoji: a.article_emoji ? String(a.article_emoji) : null,
    tags: parseTagData(a.tag_data),
    published_at: a.published_at ? String(a.published_at) : null,
    publish_date: a.publish_date ? String(a.publish_date) : null,
    published_path: a.published_path ? String(a.published_path) : null,
    source_pub_date: a.source_pub_date ? String(a.source_pub_date) : null,
    image_url: a.image_url ? String(a.image_url) : null,
    social_posted_at: a.social_posted_at ? String(a.social_posted_at) : null,
  }));

  const allTags = tagsResult.rows.map((t) => ({
    id: Number(t.id),
    name: String(t.name),
    emoji: String(t.emoji),
  }));

  return <HistoryClient initialArticles={articles} allTags={allTags} />;
}
