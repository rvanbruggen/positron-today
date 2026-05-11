import db from "@/lib/db";
import { runFetchChunk, runClassifyBatch, runExport, appendLog, updateRun } from "@/lib/pipeline-steps";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const runId = body.runId as number | undefined;

  const targetSql = runId
    ? `SELECT id, status, phase, "offset", total_sources, sources_done,
             queued, classified, added, filtered, errored, queue_depth,
             error_message, log, started_at, finished_at
       FROM pipeline_runs WHERE id = ?`
    : `SELECT id, status, phase, "offset", total_sources, sources_done,
             queued, classified, added, filtered, errored, queue_depth,
             error_message, log, started_at, finished_at
       FROM pipeline_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1`;
  const targetArgs = runId ? [runId] : [];
  const result = await db.execute({ sql: targetSql, args: targetArgs });

  if (result.rows.length === 0) {
    return Response.json({ error: "No active run" }, { status: 404 });
  }

  const row = result.rows[0];
  const id = Number(row.id);

  if (row.status === "running") {
    try {
      const phase = row.phase as string;
      const offset = Number(row.offset ?? 0);

      if (phase === "fetch") {
        await runFetchChunk(id, offset);
      } else if (phase === "classify") {
        await runClassifyBatch(id);
      } else if (phase === "export") {
        await runExport(id);
      }
    } catch (err) {
      await appendLog(id, [{ type: "fatal", message: String(err) }]);
      await updateRun(id, {
        status: "error",
        error_message: String(err),
        finished_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      });
    }
  }

  // Re-read the updated state
  const updated = await db.execute({
    sql: `SELECT id, status, phase, "offset", total_sources, sources_done,
                 queued, classified, added, filtered, errored, queue_depth,
                 error_message, log, started_at, finished_at
          FROM pipeline_runs WHERE id = ?`,
    args: [id],
  });
  const final = updated.rows[0]!;
  return Response.json({
    ...final,
    log: JSON.parse(String(final.log ?? "[]")),
  });
}
