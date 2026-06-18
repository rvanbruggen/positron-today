/**
 * Publish timer — schedules exact-time timers for each article's publish_date.
 *
 * Self-hosted mode only. Instead of polling every N minutes to find due articles,
 * this creates a setTimeout for each scheduled article that fires at the exact
 * publish time. When the timer fires, it publishes the article, waits for the
 * GitHub Pages deploy, and posts to social media.
 *
 * On server restart, all scheduled articles are scanned and timers are re-created.
 * When an article's publish_date changes, call scheduleArticle() to update its timer.
 */

import db from "@/lib/db";
import { parseScheduleWallString } from "@/lib/schedule-time";
import { publishScheduledArticles } from "@/lib/publish-core";
import { postPendingSocial } from "@/lib/social-post-core";

// Map of article ID → timer handle
const activeTimers = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Publish a single article by ID, then post to social.
 */
async function publishAndPost(articleId: number): Promise<void> {
  activeTimers.delete(articleId);

  // Verify the article is still scheduled (it might have been manually published or unscheduled)
  const check = await db.execute({
    sql: "SELECT id, title_en, title_nl, status, publish_date FROM articles WHERE id = ?",
    args: [articleId],
  });
  const article = check.rows[0];
  if (!article || article.status !== "scheduled") {
    console.log(`[publish-timer] Article ${articleId} is no longer scheduled, skipping`);
    return;
  }

  const title = String(article.title_en ?? article.title_nl ?? articleId);
  console.log(`[publish-timer] Publishing article ${articleId}: "${title}"`);

  try {
    const result = await publishScheduledArticles();
    const published = result.results.find(r => r.id === articleId);

    if (published?.ok) {
      console.log(`[publish-timer] Published "${title}" → ${published.path}`);

      // Post to social (polls for deploy liveness automatically)
      const socialResult = await postPendingSocial({ waitForLive: true, maxWaitSeconds: 300 });
      console.log(`[publish-timer] Social: ${socialResult.posted} posted, ${socialResult.skipped} skipped`);
    } else if (published?.error) {
      console.error(`[publish-timer] Failed to publish "${title}": ${published.error}`);
    }
  } catch (err) {
    console.error(`[publish-timer] Error publishing article ${articleId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Schedule (or reschedule) a timer for a specific article.
 * Call this when an article's publish_date is set or changed.
 */
export function scheduleArticle(articleId: number, publishDate: string): void {
  // Cancel any existing timer for this article
  cancelArticle(articleId);

  const publishAt = parseScheduleWallString(publishDate);
  const now = new Date();
  const delayMs = publishAt.getTime() - now.getTime();

  if (delayMs <= 0) {
    // Already due — publish immediately
    console.log(`[publish-timer] Article ${articleId} is already due, publishing now`);
    publishAndPost(articleId);
    return;
  }

  const timer = setTimeout(() => publishAndPost(articleId), delayMs);
  activeTimers.set(articleId, timer);

  const minutesUntil = Math.round(delayMs / 60_000);
  console.log(`[publish-timer] Article ${articleId} scheduled for ${publishDate} (in ${minutesUntil} min)`);
}

/**
 * Cancel the timer for an article (e.g. when unscheduled or deleted).
 */
export function cancelArticle(articleId: number): void {
  const existing = activeTimers.get(articleId);
  if (existing) {
    clearTimeout(existing);
    activeTimers.delete(articleId);
  }
}

/**
 * Cancel all active timers.
 */
export function cancelAllTimers(): void {
  for (const [id, timer] of activeTimers) {
    clearTimeout(timer);
    activeTimers.delete(id);
  }
  console.log("[publish-timer] All timers cancelled");
}

/**
 * Scan the database for all scheduled articles and create timers.
 * Call this on server startup and after scheduler reload.
 */
export async function syncTimersFromDb(): Promise<void> {
  cancelAllTimers();

  const result = await db.execute(`
    SELECT id, publish_date
    FROM articles
    WHERE status = 'scheduled'
      AND publish_date IS NOT NULL
      AND summary_en IS NOT NULL
    ORDER BY publish_date ASC
  `);

  if (result.rows.length === 0) {
    console.log("[publish-timer] No scheduled articles found");
    return;
  }

  for (const row of result.rows) {
    const id = Number(row.id);
    const publishDate = String(row.publish_date);
    scheduleArticle(id, publishDate);
  }

  console.log(`[publish-timer] ${result.rows.length} article timer(s) set`);
}

/**
 * Get the number of active timers (for status display).
 */
export function getActiveTimerCount(): number {
  return activeTimers.size;
}
