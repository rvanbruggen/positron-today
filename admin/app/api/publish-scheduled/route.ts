/**
 * Publish Scheduled Articles
 *
 * GET  /api/publish-scheduled — dry-run: returns articles due for publishing
 * POST /api/publish-scheduled — actually publishes them
 *
 * Core logic is in lib/publish-core.ts; this route is a thin wrapper.
 */

import db from "@/lib/db";
import { parseScheduleWallString } from "@/lib/schedule-time";
import { publishScheduledArticles } from "@/lib/publish-core";

export async function GET() {
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
    const publishAt = parseScheduleWallString(String(r.publish_date));
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

export async function POST() {
  const result = await publishScheduledArticles();

  if (result.error) {
    return Response.json(result, { status: 500 });
  }
  return Response.json(result);
}
