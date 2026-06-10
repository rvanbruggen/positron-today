import db from "@/lib/db";
import { resumeIfNeeded } from "@/lib/pipeline-worker";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await resumeIfNeeded();
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");

  if (runId) {
    const result = await db.execute({
      sql: `SELECT id, status, phase, "offset", total_sources, sources_done,
                   queued, classified, added, filtered, errored, queue_depth,
                   error_message, log, started_at, finished_at
            FROM pipeline_runs WHERE id = ?`,
      args: [runId],
    });
    if (result.rows.length === 0) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }
    const row = result.rows[0];
    return Response.json({
      ...row,
      log: JSON.parse(String(row.log ?? "[]")),
    });
  }

  // No runId → return the most recent run (if any).
  const result = await db.execute(
    "SELECT id, status, phase, total_sources, sources_done, queued, classified, added, filtered, errored, queue_depth, error_message, started_at, finished_at FROM pipeline_runs ORDER BY id DESC LIMIT 1",
  );
  if (result.rows.length === 0) {
    return Response.json({ run: null });
  }
  return Response.json({ run: result.rows[0] });
}
