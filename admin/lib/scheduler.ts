/**
 * Built-in scheduler.
 *
 * Uses node-cron to trigger the pipeline at configured run times,
 * and exact-time publish timers for individual articles.
 *
 * Started from instrumentation.ts on server boot.
 */

import * as cron from "node-cron";
import { getSettings } from "@/lib/settings";
import { runUnifiedPipeline } from "@/lib/unified-pipeline";
import { syncTimersFromDb, cancelAllTimers } from "@/lib/publish-timer";
import { syncEditorialTimersFromDb, cancelAllEditorialTimers } from "@/lib/editorial-publish-timer";
import { runDigest } from "@/lib/digest-core";
import { runScoreTracker } from "@/lib/score-tracker";

let activeJobs: ReturnType<typeof cron.schedule>[] = [];
let initialized = false;

/**
 * Parse "HH:MM" strings into cron expressions.
 * "08:00" → "0 8 * * *", "15:30" → "30 15 * * *"
 */
function timeToCron(time: string): string | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${minute} ${hour} * * *`;
}

/**
 * Stop all active cron jobs and publish timers.
 */
export function stopScheduler(): void {
  for (const job of activeJobs) {
    job.stop();
  }
  activeJobs = [];
  cancelAllTimers();
  cancelAllEditorialTimers();
  console.log("[scheduler] All jobs and timers stopped");
}

/**
 * Reload the scheduler with current settings.
 * Call this when run times are changed in the admin UI.
 */
export async function reloadScheduler(): Promise<void> {
  stopScheduler();

  const settings = await getSettings();

  let runTimes: string[];
  try {
    runTimes = JSON.parse(settings.positronitron_run_times);
  } catch {
    runTimes = ["08:00", "15:00"];
  }

  const tz = process.env.SCHEDULE_TZ ?? "Europe/Brussels";

  for (const time of runTimes) {
    const cronExpr = timeToCron(time);
    if (!cronExpr) {
      console.warn(`[scheduler] Invalid time format: ${time}, skipping`);
      continue;
    }

    const job = cron.schedule(cronExpr, async () => {
      const currentSettings = await getSettings();
      const mode = currentSettings.positronitron_mode;

      if (mode === "off") {
        console.log(`[scheduler] ${time} — mode is "off", skipping`);
        return;
      }

      console.log(`[scheduler] Triggered by ${time} slot (mode=${mode})`);

      await runUnifiedPipeline();

      await syncTimersFromDb();
    }, {
      timezone: tz,
    });

    activeJobs.push(job);
    console.log(`[scheduler] Pipeline scheduled: ${time} (${cronExpr}) TZ=${tz}`);
  }

  // ─── Digest cron jobs ──────────────────────────────────────────────────────

  let digestTimes: string[];
  try {
    digestTimes = JSON.parse(settings.digest_run_times ?? "[]");
  } catch {
    digestTimes = [];
  }

  for (const time of digestTimes) {
    const cronExpr = timeToCron(time);
    if (!cronExpr) {
      console.warn(`[scheduler] Invalid digest time format: ${time}, skipping`);
      continue;
    }

    const job = cron.schedule(cronExpr, async () => {
      console.log(`[scheduler] Digest triggered by ${time} slot`);
      try {
        const result = await runDigest();
        if (result.ok) {
          console.log(`[scheduler] Digest posted: ${result.articles?.length ?? 0} articles`);
        } else {
          console.log(`[scheduler] Digest skipped: ${result.message ?? result.error ?? "unknown"}`);
        }
      } catch (err) {
        console.error(`[scheduler] Digest error:`, err instanceof Error ? err.message : err);
      }
    }, {
      timezone: tz,
    });

    activeJobs.push(job);
    console.log(`[scheduler] Digest scheduled: ${time} (${cronExpr}) TZ=${tz}`);
  }

  // ─── Score tracker cron jobs ───────────────────────────────────────────────

  let scoreTimes: string[];
  try {
    scoreTimes = JSON.parse(settings.score_run_times ?? "[]");
  } catch {
    scoreTimes = [];
  }

  for (const time of scoreTimes) {
    const cronExpr = timeToCron(time);
    if (!cronExpr) {
      console.warn(`[scheduler] Invalid score time format: ${time}, skipping`);
      continue;
    }

    const job = cron.schedule(cronExpr, async () => {
      console.log(`[scheduler] Score tracker triggered by ${time} slot`);
      try {
        const result = await runScoreTracker();
        console.log(`[scheduler] Score tracker done: ${result.scored} scored, ${result.failed} failed`);
      } catch (err) {
        console.error(`[scheduler] Score tracker error:`, err instanceof Error ? err.message : err);
      }
    }, {
      timezone: tz,
    });

    activeJobs.push(job);
    console.log(`[scheduler] Score tracker scheduled: ${time} (${cronExpr}) TZ=${tz}`);
  }

  // Sync publish timers from the database
  await syncTimersFromDb();
  await syncEditorialTimersFromDb();

  console.log(`[scheduler] Active with ${activeJobs.length} cron jobs`);
}

/**
 * Initialize the scheduler. Called once from instrumentation.ts.
 */
export async function initScheduler(): Promise<void> {
  if (initialized) {
    // Already initialized — reload instead (handles dev hot reload)
    await reloadScheduler();
    return;
  }

  initialized = true;
  await reloadScheduler();
}
