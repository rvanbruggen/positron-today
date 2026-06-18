/**
 * Built-in scheduler for self-hosted deployment mode.
 *
 * Uses node-cron to trigger the pipeline at configured run times,
 * and exact-time publish timers for individual articles.
 *
 * - In "fetch" mode: runs the chunked pipeline (fetch + classify + export),
 *   creating a pipeline_run visible in the Fetch & Filter UI.
 * - In "summarise" or "full" mode: runs the unified pipeline
 *   (fetch + classify + positronitron + publish + social).
 * - In "off" mode: does nothing.
 *
 * Started from instrumentation.ts when DEPLOYMENT_MODE=self-hosted.
 */

import * as cron from "node-cron";
import { getSettings } from "@/lib/settings";
import { runUnifiedPipeline } from "@/lib/unified-pipeline";
import { drainPipeline } from "@/lib/pipeline-steps";
import { syncTimersFromDb, cancelAllTimers } from "@/lib/publish-timer";
import { runDigest } from "@/lib/digest-core";

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
  console.log("[scheduler] All jobs and timers stopped");
}

/**
 * Reload the scheduler with current settings.
 * Call this when run times are changed in the admin UI.
 */
export async function reloadScheduler(): Promise<void> {
  stopScheduler();

  const settings = await getSettings();
  if (settings.deployment_mode !== "self-hosted") {
    console.log("[scheduler] Not in self-hosted mode, scheduler inactive");
    return;
  }

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

      if (mode === "fetch") {
        // Fetch mode: use the chunked pipeline so the run is visible in the UI
        await drainPipeline();
      } else {
        // Summarise / full mode: use the unified pipeline
        await runUnifiedPipeline();
      }

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

  // Sync publish timers from the database
  await syncTimersFromDb();

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
