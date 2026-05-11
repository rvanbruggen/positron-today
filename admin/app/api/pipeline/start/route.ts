import { after } from "next/server";
import db from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { selfFetch } from "@/lib/self-url";

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
    } else {
      return Response.json(
        { error: "A pipeline run is already in progress.", runId: existing.rows[0].id },
        { status: 409 },
      );
    }
  }

  const totalResult = await db.execute(
    "SELECT COUNT(*) AS c FROM sources WHERE active = 1 AND (feed_url IS NOT NULL OR type = 'rss')",
  );
  const totalSources = Number(totalResult.rows[0]?.c ?? 0);

  const result = await db.execute({
    sql: `INSERT INTO pipeline_runs (status, phase, total_sources) VALUES ('running', 'fetch', ?)`,
    args: [totalSources],
  });
  const runId = Number(result.lastInsertRowid);

  after(async () => {
    try {
      const res = await selfFetch("/api/pipeline/step", { runId, phase: "fetch", offset: 0 });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Step self-call returned ${res.status}: ${body.slice(0, 200)}`);
      }
    } catch (err) {
      const msg = `Failed to start first step: ${err}`;
      await db.execute({
        sql: `UPDATE pipeline_runs SET status = 'error', error_message = ?, log = ?, finished_at = datetime('now') WHERE id = ?`,
        args: [msg, JSON.stringify([{ type: "fatal", message: msg }]), runId],
      });
    }
  });

  return Response.json({ runId });
}
