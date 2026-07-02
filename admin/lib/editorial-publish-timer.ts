/**
 * Editorial publish timer — schedules exact-time timers for editorial publish_date.
 *
 * Mirrors publish-timer.ts but for editorials. On timer fire, calls
 * publishEditorial() then lets its built-in Substack delay handle cross-posting.
 */

import db from "@/lib/db";
import { parseScheduleWallString } from "@/lib/schedule-time";
import { publishEditorial } from "@/lib/editorial-core";

const activeTimers = new Map<number, ReturnType<typeof setTimeout>>();

async function publishWhenDue(editorialId: number): Promise<void> {
  activeTimers.delete(editorialId);

  const check = await db.execute({
    sql: "SELECT id, title_en, status, publish_date FROM editorials WHERE id = ?",
    args: [editorialId],
  });
  const editorial = check.rows[0];
  if (!editorial || editorial.status !== "scheduled") {
    console.log(`[editorial-timer] Editorial ${editorialId} is no longer scheduled, skipping`);
    return;
  }

  const title = String(editorial.title_en ?? editorialId);
  console.log(`[editorial-timer] Publishing editorial ${editorialId}: "${title}"`);

  try {
    const result = await publishEditorial(editorialId);
    if (result.ok) {
      console.log(`[editorial-timer] Published "${title}" → ${result.editorialPath}`);
    } else {
      console.error(`[editorial-timer] Failed to publish "${title}": ${result.error}`);
    }
  } catch (err) {
    console.error(`[editorial-timer] Error publishing editorial ${editorialId}:`, err instanceof Error ? err.message : err);
  }
}

export function scheduleEditorial(editorialId: number, publishDate: string): void {
  cancelEditorial(editorialId);

  const publishAt = parseScheduleWallString(publishDate);
  const now = new Date();
  const delayMs = publishAt.getTime() - now.getTime();

  if (delayMs <= 0) {
    console.log(`[editorial-timer] Editorial ${editorialId} is already due, publishing now`);
    publishWhenDue(editorialId);
    return;
  }

  const timer = setTimeout(() => publishWhenDue(editorialId), delayMs);
  activeTimers.set(editorialId, timer);

  const minutesUntil = Math.round(delayMs / 60_000);
  console.log(`[editorial-timer] Editorial ${editorialId} scheduled for ${publishDate} (in ${minutesUntil} min)`);
}

export function cancelEditorial(editorialId: number): void {
  const existing = activeTimers.get(editorialId);
  if (existing) {
    clearTimeout(existing);
    activeTimers.delete(editorialId);
  }
}

export function cancelAllEditorialTimers(): void {
  for (const [, timer] of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.clear();
  console.log("[editorial-timer] All editorial timers cancelled");
}

export async function syncEditorialTimersFromDb(): Promise<void> {
  cancelAllEditorialTimers();

  const result = await db.execute(`
    SELECT id, publish_date
    FROM editorials
    WHERE status = 'scheduled'
      AND publish_date IS NOT NULL
    ORDER BY publish_date ASC
  `);

  if (result.rows.length === 0) {
    console.log("[editorial-timer] No scheduled editorials found");
    return;
  }

  for (const row of result.rows) {
    scheduleEditorial(Number(row.id), String(row.publish_date));
  }

  console.log(`[editorial-timer] ${result.rows.length} editorial timer(s) set`);
}

export function getActiveEditorialTimerCount(): number {
  return activeTimers.size;
}
