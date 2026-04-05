export const dynamic = "force-dynamic";

import db from "@/lib/db";
import ScheduledClient from "./ScheduledClient";

function parseTagData(raw: unknown): { id: number; name: string; emoji: string }[] {
  if (!raw) return [];
  return String(raw).split("~~").filter(Boolean).map((s) => {
    const [id, name, emoji] = s.split("|");
    return { id: Number(id), name: name ?? "", emoji: emoji ?? "📰" };
  });
}

export default async function ScheduledPage() {
  const [articlesResult, tagsResult] = await Promise.all([
    db.execute(`
      SELECT a.*,
             r.title as raw_title,
             (SELECT GROUP_CONCAT(t.id || '|' || t.name || '|' || t.emoji, '~~')
              FROM article_tags at2
              JOIN topics t ON at2.tag_id = t.id
              WHERE at2.article_id = a.id) as tag_data
      FROM articles a
      LEFT JOIN raw_articles r ON a.raw_article_id = r.id
      WHERE a.status IN ('draft', 'scheduled')
      ORDER BY a.status ASC, a.publish_date ASC
    `),
    db.execute("SELECT id, name, emoji FROM topics ORDER BY name ASC"),
  ]);

  const articles = articlesResult.rows.map((a) => ({
    id: Number(a.id),
    status: String(a.status),
    source_url: String(a.source_url),
    source_name: String(a.source_name),
    raw_title: a.raw_title ? String(a.raw_title) : null,
    article_emoji: a.article_emoji ? String(a.article_emoji) : null,
    tags: parseTagData(a.tag_data),
    title_en: a.title_en ? String(a.title_en) : null,
    title_nl: a.title_nl ? String(a.title_nl) : null,
    title_fr: a.title_fr ? String(a.title_fr) : null,
    summary_en: a.summary_en ? String(a.summary_en) : null,
    summary_nl: a.summary_nl ? String(a.summary_nl) : null,
    summary_fr: a.summary_fr ? String(a.summary_fr) : null,
    publish_date: a.publish_date ? String(a.publish_date) : null,
  }));

  const tags = tagsResult.rows.map((t) => ({
    id: Number(t.id),
    name: String(t.name),
    emoji: String(t.emoji),
  }));

  return <ScheduledClient initialArticles={articles} tags={tags} />;
}
