export const dynamic = "force-dynamic";

import db from "@/lib/db";
import HistoryClient from "./HistoryClient";

export default async function HistoryPage() {
  const result = await db.execute(`
    SELECT a.id, a.title_en, a.title_nl, a.source_url, a.source_name,
           a.published_at, a.publish_date,
           t.name as topic_name, t.emoji as topic_emoji
    FROM articles a
    LEFT JOIN topics t ON a.topic_id = t.id
    WHERE a.status = 'published'
    ORDER BY a.published_at DESC
    LIMIT 100
  `);

  const articles = result.rows.map((a) => ({
    id: Number(a.id),
    title_en: a.title_en ? String(a.title_en) : null,
    title_nl: a.title_nl ? String(a.title_nl) : null,
    source_url: String(a.source_url),
    source_name: String(a.source_name),
    topic_name: a.topic_name ? String(a.topic_name) : null,
    topic_emoji: a.topic_emoji ? String(a.topic_emoji) : null,
    published_at: a.published_at ? String(a.published_at) : null,
    publish_date: a.publish_date ? String(a.publish_date) : null,
  }));

  return <HistoryClient initialArticles={articles} />;
}
