import db from "@/lib/db";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const runId = body.runId;

  // Find the run to stop
  const targetSql = runId
    ? "SELECT id, log FROM pipeline_runs WHERE id = ? AND status = 'running'"
    : "SELECT id, log FROM pipeline_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1";
  const targetArgs = runId ? [runId] : [];

  const target = await db.execute({ sql: targetSql, args: targetArgs });
  if (target.rows.length === 0) {
    return Response.json({ stopped: false });
  }

  const row = target.rows[0];
  const id = Number(row.id);
  const existingLog: object[] = JSON.parse(String(row.log ?? "[]"));
  existingLog.push({ type: "fatal", message: "Cancelled by user" });

  await db.execute({
    sql: `UPDATE pipeline_runs
          SET status = 'error',
              error_message = 'Cancelled by user',
              log = ?,
              finished_at = datetime('now')
          WHERE id = ?`,
    args: [JSON.stringify(existingLog), id],
  });

  // Drain leftover pending_items so a fresh run starts clean
  await db.execute("DELETE FROM pending_items");

  return Response.json({ stopped: true, runId: id });
}
