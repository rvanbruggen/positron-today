/**
 * Suggest Schedule
 *
 * Assigns staggered publish_date values to all articles with status='scheduled'
 * that do not yet have a publish_date, chaining after the latest existing
 * scheduled slot so that articles are spaced evenly.
 *
 * POST /api/suggest-schedule
 *   body: { interval_minutes?: number }   — default 30
 *   response: { scheduled: N, slots: [{ id, title, publish_date }] }
 */

import { NextRequest } from "next/server";
import db from "@/lib/db";

/** Return a publish time at least `bufferMinutes` after `after`, snapped to
 *  the next interval boundary, then jittered by 1–9 minutes so times look
 *  human-picked rather than landing exactly on :00 or :30. */
function nextSlot(after: Date, intervalMinutes: number, bufferMinutes = 2): Date {
  const t = new Date(after.getTime() + bufferMinutes * 60 * 1000);
  const totalMins = t.getHours() * 60 + t.getMinutes();
  const rounded = Math.ceil(totalMins / intervalMinutes) * intervalMinutes;
  const jitter = 1 + Math.floor(Math.random() * 9);
  const result = new Date(t);
  result.setHours(Math.floor((rounded + jitter) / 60), (rounded + jitter) % 60, 0, 0);
  if (result <= after) result.setDate(result.getDate() + 1);
  return result;
}

function toLocalISO(d: Date): string {
  // "YYYY-MM-DDTHH:MM:SS" in local time — what SQLite and datetime-local both expect
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
  );
}

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
    const dateStr = toLocalISO(cursor);

    await db.execute({
      sql: "UPDATE articles SET publish_date = ? WHERE id = ?",
      args: [dateStr, id],
    });

    slots.push({ id, title, publish_date: dateStr });
    cursor = nextSlot(cursor, intervalMinutes);
  }

  return Response.json({ scheduled: slots.length, slots });
}
