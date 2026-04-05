export const dynamic = "force-dynamic";

import db from "@/lib/db";
import ScheduledClient from "./ScheduledClient";

export default async function ScheduledPage() {
  const result = await db.execute(`
    SELECT a.*, t.name as topic_name, t.emoji as topic_emoji,
           r.title as raw_title
    FROM articles a
    LEFT JOIN topics t ON a.topic_id = t.id
    LEFT JOIN raw_articles r ON a.raw_article_id = r.id
    WHERE a.status IN ('draft', 'scheduled')
    ORDER BY a.status ASC, a.publish_date ASC
  `);

  const articles = result.rows.map((a) => ({
    id: Number(a.id),
    status: String(a.status),
    source_url: String(a.source_url),
    source_name: String(a.source_name),
    raw_title: a.raw_title ? String(a.raw_title) : null,
    topic_name: a.topic_name ? String(a.topic_name) : null,
    topic_emoji: a.topic_emoji ? String(a.topic_emoji) : null,
    title_en: a.title_en ? String(a.title_en) : null,
    title_nl: a.title_nl ? String(a.title_nl) : null,
    title_fr: a.title_fr ? String(a.title_fr) : null,
    summary_en: a.summary_en ? String(a.summary_en) : null,
    summary_nl: a.summary_nl ? String(a.summary_nl) : null,
    summary_fr: a.summary_fr ? String(a.summary_fr) : null,
    publish_date: a.publish_date ? String(a.publish_date) : null,
  }));

  return <ScheduledClient initialArticles={articles} />;
}
