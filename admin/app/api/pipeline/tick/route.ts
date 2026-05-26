import db from "@/lib/db";
import { runFetchChunk, runClassifyBatch, runExport, appendLog, updateRun } from "@/lib/pipeline-steps";

export const dynamic = "force-dynamic";

const CLASSIFY_BATCH = 15;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const runId = body.runId as number | undefined;

  // Always release pending_items claimed >90s ago but never deleted (crashed batch).
  // Done outside the run-status gate so orphaned claims from a finished run can
  // still be recovered by a subsequent tick.
  await db.execute(
    "UPDATE pending_items SET claimed_at = NULL WHERE claimed_at IS NOT NULL AND claimed_at < datetime('now', '-90 seconds')",
  );

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

  if (status === "running") {
    // Reset tasks stuck in 'running' for >90 seconds (Vercel timeout recovery)
    await db.execute({
      sql: `UPDATE pipeline_tasks SET status = 'pending', started_at = NULL
            WHERE run_id = ? AND status = 'running'
              AND started_at < datetime('now', '-90 seconds')`,
      args: [id],
    });

    // Pick the next pending task
    const taskResult = await db.execute({
      sql: `SELECT id, kind, payload FROM pipeline_tasks
            WHERE run_id = ? AND status = 'pending'
            ORDER BY seq ASC, id ASC LIMIT 1`,
      args: [id],
    });

    if (taskResult.rows.length === 0) {
      // Only finish if no tasks are still running (another tick may be executing one)
      const stillRunning = await db.execute({
        sql: `SELECT id FROM pipeline_tasks WHERE run_id = ? AND status = 'running' LIMIT 1`,
        args: [id],
      });
      if (stillRunning.rows.length === 0) {
        await updateRun(id, {
          status: "done",
          finished_at: new Date().toISOString().replace("T", " ").slice(0, 19),
        });
      }
    } else {
      const task = taskResult.rows[0];
      const taskId = Number(task.id);
      const kind = task.kind as string;
      const payload = JSON.parse(String(task.payload ?? "{}"));

      // Claim the task (compare-and-swap to handle concurrent callers)
      const claim = await db.execute({
        sql: `UPDATE pipeline_tasks SET status = 'running', started_at = datetime('now')
              WHERE id = ? AND status = 'pending'`,
        args: [taskId],
      });
      if (claim.rowsAffected === 0) {
        // Another caller claimed it — return current state without processing
      } else {
        try {
          if (kind === "fetch_chunk") {
            await updateRun(id, { phase: "fetch" });
            await runFetchChunk(id, payload.offset ?? 0);
          } else if (kind === "plan_classify") {
            await planClassifyTasks(id);
          } else if (kind === "classify_batch") {
            await updateRun(id, { phase: "classify" });
            await runClassifyBatch(id);
            // Dynamically enqueue the next step based on remaining items
            await enqueueNextAfterClassify(id);
          } else if (kind === "export") {
            await updateRun(id, { phase: "export" });
            await runExport(id);
          }

          await db.execute({
            sql: "UPDATE pipeline_tasks SET status = 'done', finished_at = datetime('now') WHERE id = ?",
            args: [taskId],
          });
        } catch (err) {
          await db.execute({
            sql: "UPDATE pipeline_tasks SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?",
            args: [String(err), taskId],
          });
          await appendLog(id, [{ type: "fatal", message: String(err) }]);
          await updateRun(id, {
            status: "error",
            error_message: String(err),
            finished_at: new Date().toISOString().replace("T", " ").slice(0, 19),
          });
        }
      }
    }
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

async function planClassifyTasks(runId: number) {
  const countResult = await db.execute("SELECT COUNT(*) AS c FROM pending_items WHERE claimed_at IS NULL");
  const pendingCount = Number(countResult.rows[0]?.c ?? 0);

  const maxSeqResult = await db.execute({
    sql: "SELECT MAX(seq) AS m FROM pipeline_tasks WHERE run_id = ?",
    args: [runId],
  });
  const nextSeq = Number(maxSeqResult.rows[0]?.m ?? 0) + 1;

  if (pendingCount > 0) {
    // Create one classify_batch; it will enqueue the next one if items remain
    await db.execute({
      sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'classify_batch', ?)`,
      args: [runId, nextSeq],
    });
    await updateRun(runId, { phase: "classify" });
  } else {
    await db.execute({
      sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'export', ?)`,
      args: [runId, nextSeq],
    });
    await updateRun(runId, { phase: "export" });
  }
}

async function enqueueNextAfterClassify(runId: number) {
  const remaining = Number(
    (await db.execute("SELECT COUNT(*) AS c FROM pending_items WHERE claimed_at IS NULL")).rows[0]?.c ?? 0,
  );

  // Check if there's already a pending classify_batch or export task queued
  const alreadyQueued = await db.execute({
    sql: `SELECT id FROM pipeline_tasks
          WHERE run_id = ? AND status = 'pending' AND kind IN ('classify_batch', 'export')
          LIMIT 1`,
    args: [runId],
  });
  if (alreadyQueued.rows.length > 0) return;

  const maxSeqResult = await db.execute({
    sql: "SELECT MAX(seq) AS m FROM pipeline_tasks WHERE run_id = ?",
    args: [runId],
  });
  const nextSeq = Number(maxSeqResult.rows[0]?.m ?? 0) + 1;

  if (remaining > 0) {
    await db.execute({
      sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'classify_batch', ?)`,
      args: [runId, nextSeq],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'export', ?)`,
      args: [runId, nextSeq],
    });
  }
}
