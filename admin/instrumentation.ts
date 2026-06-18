/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Initializes the built-in scheduler for pipeline and digest cron jobs.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initScheduler } = await import("./lib/scheduler");
    await initScheduler();
    console.log("[positron] Scheduler started");
  }
}
