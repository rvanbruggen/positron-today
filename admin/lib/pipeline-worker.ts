import { runOneTick } from "./pipeline-steps";
import db from "./db";

const TICK_INTERVAL_MS = 3_000;

let activeRunId: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

async function tick() {
  if (activeRunId === null) {
    stop();
    return;
  }

  try {
    const status = await runOneTick(activeRunId);
    if (status === "done" || status === "error") {
      console.log(`[pipeline-worker] Run ${activeRunId} finished (${status})`);
      stop();
    }
  } catch (err) {
    console.error(`[pipeline-worker] Tick error for run ${activeRunId}:`, err);
  }
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  activeRunId = null;
}

/**
 * Ensure a background worker is ticking the given pipeline run.
 * Safe to call repeatedly — only one loop runs at a time.
 */
export function ensureWorkerRunning(runId: number) {
  if (timer && activeRunId === runId) return;

  stop();
  activeRunId = runId;
  console.log(`[pipeline-worker] Starting background ticks for run ${runId}`);
  tick();
  timer = setInterval(tick, TICK_INTERVAL_MS);
}

/**
 * Check if there's already a running pipeline and resume the worker.
 * Called on first request to recover from server restarts.
 */
export async function resumeIfNeeded() {
  if (timer) return;

  try {
    const result = await db.execute(
      "SELECT id FROM pipeline_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1",
    );
    if (result.rows.length > 0) {
      const runId = Number(result.rows[0].id);
      console.log(`[pipeline-worker] Resuming run ${runId} after server restart`);
      ensureWorkerRunning(runId);
    }
  } catch {}
}
