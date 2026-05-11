import db from "@/lib/db";
import { runFetchChunk, runClassifyBatch, runExport, appendLog, updateRun } from "@/lib/pipeline-steps";

export const dynamic = "force-dynamic";

const CLASSIFY_BATCH = 15;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const runId = body.runId as number | undefined;

  // Find the target run
  const runSql = runId
    ? "SELECT id, status FROM pipeline_runs WHERE id = ?"
    : `SELECT id, status FROM pipeline_runs ORDER BY
         CASE status WHEN 'running' THEN 0 ELSE 1 END,
         id DESC LIMIT 1`;
  const runResult = await db.execute({ sql: runSql, args: runId ? [runId] : [] });

  if (runResult.rows.length === 0) {
    return Response.json({ error: "No active run" }, { status: 404 });
  }

  const id = Number(runResult.rows[0].id);
  const status = runResult.rows[0].status as string;

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
      // All tasks done — mark the run as complete
      await updateRun(id, {
        status: "done",
        finished_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      });
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
  const countResult = await db.execute("SELECT COUNT(*) AS c FROM pending_items");
  const pendingCount = Number(countResult.rows[0]?.c ?? 0);

  const maxSeqResult = await db.execute({
    sql: "SELECT MAX(seq) AS m FROM pipeline_tasks WHERE run_id = ?",
    args: [runId],
  });
  let nextSeq = Number(maxSeqResult.rows[0]?.m ?? 0) + 1;

  if (pendingCount > 0) {
    const numBatches = Math.ceil(pendingCount / CLASSIFY_BATCH);
    for (let i = 0; i < numBatches; i++) {
      await db.execute({
        sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'classify_batch', ?)`,
        args: [runId, nextSeq + i],
      });
    }
    nextSeq += numBatches;
    await updateRun(runId, { phase: "classify" });
  } else {
    await updateRun(runId, { phase: "export" });
  }

  await db.execute({
    sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'export', ?)`,
    args: [runId, nextSeq],
  });
}
