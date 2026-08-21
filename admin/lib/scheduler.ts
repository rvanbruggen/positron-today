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
import { runNeverSkipIfDue } from "@/lib/never-skip";

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
 * Parse "D HH:MM" into a weekly cron expression, where D is 0-6 with Sunday=0.
 * "1 06:00" → "0 6 * * 1" (Mondays at 06:00)
 */
function weeklyTimeToCron(spec: string): string | null {
  const match = spec.trim().match(/^([0-6])\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const hour = parseInt(match[2], 10);
  const minute = parseInt(match[3], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${minute} ${hour} * * ${day}`;
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

  // ─── Necessary Negativity weekly job ───────────────────────────────────────
  //
  // The cron is only a trigger. runNeverSkipIfDue() asks whether the last
  // completed week already has an entry, so a missed firing (container
  // restart, downtime) is picked up by the next tick or the next boot rather
  // than losing the week entirely.
  const neverSkipSpec = (settings.neverskip_run_time ?? "").trim();
  if (neverSkipSpec) {
    const cronExpr = weeklyTimeToCron(neverSkipSpec);
    if (!cronExpr) {
      console.warn(`[scheduler] Invalid neverskip_run_time "${neverSkipSpec}" (expected "D HH:MM", Sunday=0), skipping`);
    } else {
      const job = cron.schedule(cronExpr, async () => {
        console.log(`[scheduler] Necessary Negativity triggered by ${neverSkipSpec} slot`);
        try {
          const result = await runNeverSkipIfDue();
          if (result.skipped)   console.log(`[scheduler] Necessary Negativity skipped: ${result.reason}`);
          else if (result.ok)   console.log(`[scheduler] Necessary Negativity published ${result.week}`);
          else                  console.error(`[scheduler] Necessary Negativity failed: ${result.error}`);
        } catch (err) {
          console.error(`[scheduler] Necessary Negativity error:`, err instanceof Error ? err.message : err);
        }
      }, {
        timezone: tz,
      });

      activeJobs.push(job);
      console.log(`[scheduler] Necessary Negativity scheduled: ${neverSkipSpec} (${cronExpr}) TZ=${tz}`);

      // Catch up on boot, in the background — a container that was down over
      // the scheduled slot should still publish the week it missed. Deferred
      // so a slow LLM round-trip never delays server start.
      setTimeout(() => {
        runNeverSkipIfDue()
          .then((r) => {
            if (r.skipped) console.log(`[scheduler] Necessary Negativity boot check: ${r.reason}`);
            else if (r.ok) console.log(`[scheduler] Necessary Negativity boot catch-up published ${r.week}`);
            else console.error(`[scheduler] Necessary Negativity boot catch-up failed: ${r.error}`);
          })
          .catch((err) => console.error("[scheduler] Necessary Negativity boot check error:", err));
      }, 30_000).unref();
    }
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
