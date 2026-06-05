/**
 * Built-in scheduler for self-hosted deployment mode.
 *
 * Uses node-cron to trigger the unified pipeline at configured run times.
 * Started from instrumentation.ts when DEPLOYMENT_MODE=self-hosted.
 *
 * The scheduler reads positronitron_run_times from settings and creates
 * cron jobs for each time slot. The unified pipeline handles all phases
 * (fetch → classify → positronitron → publish → social) in a single run.
 */

import * as cron from "node-cron";
import { getSettings } from "@/lib/settings";
import { runUnifiedPipeline } from "@/lib/unified-pipeline";

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
 * Stop all active cron jobs.
 */
export function stopScheduler(): void {
  for (const job of activeJobs) {
    job.stop();
  }
  activeJobs = [];
  console.log("[scheduler] All jobs stopped");
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
      console.log(`[scheduler] Triggered by ${time} slot`);
      await runUnifiedPipeline();
    }, {
      timezone: tz,
    });

    activeJobs.push(job);
    console.log(`[scheduler] Scheduled: ${time} (${cronExpr}) TZ=${tz}`);
  }

  // Also schedule a periodic "publish check" every 15 minutes
  // to catch any manually scheduled articles that are due
  const publishCheck = cron.schedule("*/15 * * * *", async () => {
    // Only publish + social post, don't run the full pipeline
    const { publishScheduledArticles } = await import("@/lib/publish-core");
    const result = await publishScheduledArticles();
    if (result.published > 0) {
      console.log(`[scheduler] Publish check: ${result.published} articles published`);
      // Wait for deploy, then post social
      await new Promise((r) => setTimeout(r, 60_000));
      const { postPendingSocial } = await import("@/lib/social-post-core");
      await postPendingSocial({ waitForLive: true, maxWaitSeconds: 120 });
    }
  }, { timezone: tz });
  activeJobs.push(publishCheck);
  console.log("[scheduler] Scheduled: publish check every 15 min");

  console.log(`[scheduler] Active with ${activeJobs.length} jobs`);
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
