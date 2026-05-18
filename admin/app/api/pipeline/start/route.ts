import db from "@/lib/db";
import { getSettings } from "@/lib/settings";

const FETCH_CHUNK = 15;

export async function POST() {
  const settings = await getSettings();
  if (settings.positronitron_mode === "off") {
    return Response.json({ error: "Positronitron is off." }, { status: 409 });
  }

  // Prevent overlapping runs — abort if one is already in progress.
  // Auto-stop stale runs older than 10 minutes so the UI never gets permanently stuck.
  const existing = await db.execute(
    "SELECT id, started_at FROM pipeline_runs WHERE status = 'running' LIMIT 1",
  );
  if (existing.rows.length > 0) {
    const startedAt = existing.rows[0].started_at
      ? new Date(String(existing.rows[0].started_at)).getTime()
      : 0;
    const ageMs = Date.now() - startedAt;
    if (ageMs > 10 * 60 * 1000) {
      await db.execute({
        sql: `UPDATE pipeline_runs
              SET status = 'error', error_message = 'Timed out (stale run)', finished_at = datetime('now')
              WHERE id = ?`,
        args: [existing.rows[0].id],
      });
      await db.execute("DELETE FROM pending_items");
      await db.execute({
        sql: "UPDATE pipeline_tasks SET status = 'error' WHERE run_id = ? AND status IN ('pending', 'running')",
        args: [existing.rows[0].id],
      });
    } else {
      return Response.json(
        { error: "A pipeline run is already in progress.", runId: existing.rows[0].id },
        { status: 409 },
      );
    }
  }

  // Clear any leftover pending_items from previous runs
  await db.execute("DELETE FROM pending_items");

  const totalResult = await db.execute(
    "SELECT COUNT(*) AS c FROM sources WHERE active = 1 AND (feed_url IS NOT NULL OR type = 'rss')",
  );
  const totalSources = Number(totalResult.rows[0]?.c ?? 0);

  const result = await db.execute({
    sql: `INSERT INTO pipeline_runs (status, phase, total_sources) VALUES ('running', 'fetch', ?)`,
    args: [totalSources],
  });
  const runId = Number(result.lastInsertRowid);

  // Create the task queue: fetch chunks → plan_classify sentinel
  const numChunks = Math.max(1, Math.ceil(totalSources / FETCH_CHUNK));
  for (let i = 0; i < numChunks; i++) {
    await db.execute({
      sql: `INSERT INTO pipeline_tasks (run_id, kind, seq, payload) VALUES (?, 'fetch_chunk', ?, ?)`,
      args: [runId, i, JSON.stringify({ offset: i * FETCH_CHUNK })],
    });
  }
  // plan_classify runs after all fetch chunks — it creates classify_batch + export tasks
  await db.execute({
    sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'plan_classify', ?)`,
    args: [runId, numChunks],
  });

  return Response.json({ runId });
}
