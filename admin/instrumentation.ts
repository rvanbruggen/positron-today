/**
 * Next.js instrumentation hook — runs once when the server starts.
 *
 * In self-hosted mode, initializes the built-in scheduler that replaces
 * external cron jobs. In serverless mode, this is a no-op.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const deploymentMode = process.env.DEPLOYMENT_MODE ?? "serverless";
    if (deploymentMode === "self-hosted") {
      const { initScheduler } = await import("./lib/scheduler");
      await initScheduler();
      console.log("[positron] Self-hosted scheduler started");
    } else {
      console.log("[positron] Serverless mode — built-in scheduler inactive");
    }
  }
}
