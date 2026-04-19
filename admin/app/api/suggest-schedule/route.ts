/**
 * Suggest Schedule
 *
 * Assigns staggered publish_date values to all articles with status='scheduled'
 * that do not yet have a publish_date, chaining after the latest existing
 * scheduled slot so that articles are spaced evenly.
 *
 * All times are computed in SCHEDULE_TZ (see lib/schedule-time.ts) — stored
 * strings represent wall-clock time in that zone.
 *
 * POST /api/suggest-schedule
 *   body: { interval_minutes?: number }   — default 30
 *   response: { scheduled: N, slots: [{ id, title, publish_date }] }
 */

import { NextRequest } from "next/server";
import db from "@/lib/db";
import { nextSlot, toScheduleWallString } from "@/lib/schedule-time";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const intervalMinutes: number = Math.max(5, Number(body.interval_minutes) || 30);

  // Find all scheduled articles ready for publishing — always recalculate from now
  const unscheduled = await db.execute(`
    SELECT id, title_en, title_nl
    FROM articles
    WHERE status = 'scheduled'
      AND summary_en IS NOT NULL
    ORDER BY id ASC
  `);

  if (unscheduled.rows.length === 0) {
    return Response.json({ scheduled: 0, slots: [], message: "No scheduled articles found" });
  }

  let cursor = nextSlot(new Date(), intervalMinutes);

  const slots: Array<{ id: number; title: string; publish_date: string }> = [];

  for (const row of unscheduled.rows) {
    const id = Number(row.id);
    const title = String(row.title_en ?? row.title_nl ?? id);
    const dateStr = toScheduleWallString(cursor);

    await db.execute({
      sql: "UPDATE articles SET publish_date = ? WHERE id = ?",
      args: [dateStr, id],
    });

    slots.push({ id, title, publish_date: dateStr });
    cursor = nextSlot(cursor, intervalMinutes);
  }

  return Response.json({ scheduled: slots.length, slots });
}
