import db from "@/lib/db";
import { appendLog } from "@/lib/pipeline-steps";
import { ensureWorkerRunning, resumeIfNeeded } from "@/lib/pipeline-worker";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const runId = body.runId as number | undefined;

  // Find the target run.
  let id: number;
  let status: string;

  if (runId) {
    const explicit = await db.execute({
      sql: "SELECT id, status FROM pipeline_runs WHERE id = ?",
      args: [runId],
    });
    if (explicit.rows.length === 0) {
      return Response.json({ error: "No active run" }, { status: 404 });
    }
    id = Number(explicit.rows[0].id);
    status = String(explicit.rows[0].status);
  } else {
    // Prefer an already-running run.
    const running = await db.execute(
      `SELECT id, status FROM pipeline_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1`,
    );
    if (running.rows.length > 0) {
      id = Number(running.rows[0].id);
      status = String(running.rows[0].status);
    } else {
      // No active run. If there's unclaimed work in pending_items, auto-create
      // a run so the cron can drain the queue without a browser kicking it off.
      const pendingResult = await db.execute(
        "SELECT COUNT(*) AS c FROM pending_items WHERE claimed_at IS NULL",
      );
      const pendingCount = Number(pendingResult.rows[0]?.c ?? 0);

      if (pendingCount > 0) {
        const created = await db.execute({
          sql: `INSERT INTO pipeline_runs (status, phase) VALUES ('running', 'classify')`,
          args: [],
        });
        id = Number(created.lastInsertRowid);
        status = "running";
        await db.execute({
          sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'classify_batch', 1)`,
          args: [id],
        });
        await appendLog(id, [
          { type: "info", message: `Auto-started by tick: ${pendingCount} unclaimed pending_items` },
        ]);
      } else {
        // Nothing to do. Report the most recent run (if any) for status visibility.
        const latest = await db.execute(
          `SELECT id, status FROM pipeline_runs ORDER BY id DESC LIMIT 1`,
        );
        if (latest.rows.length === 0) {
          return Response.json({ error: "No active run" }, { status: 404 });
        }
        id = Number(latest.rows[0].id);
        status = String(latest.rows[0].status);
      }
    }
  }

  // Ensure the background worker is driving this run — the browser poll
  // is now just a status reader, not the engine.
  if (status === "running") {
    ensureWorkerRunning(id);
  } else {
    // Server may have restarted — check for orphaned running pipelines
    await resumeIfNeeded();
  }

  // Return the full run state
  const final = await db.execute({
    sql: `SELECT id, status, phase, "offset", total_sources, sources_done,
                 queued, classified, added, filtered, errored, queue_depth,
                 error_message, log, started_at, finished_at
          FROM pipeline_runs WHERE id = ?`,
    args: [id],
  });
  const row = final.rows[0]!;

  // Include task progress for the UI
  const taskCounts = await db.execute({
    sql: `SELECT COUNT(*) AS total,
                 SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
          FROM pipeline_tasks WHERE run_id = ?`,
    args: [id],
  });

  return Response.json({
    ...row,
    log: JSON.parse(String(row.log ?? "[]")),
    tasks_total: Number(taskCounts.rows[0]?.total ?? 0),
    tasks_done: Number(taskCounts.rows[0]?.done ?? 0),
  });
}
