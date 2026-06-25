import db from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Read-only progress for the background "summarise all drafts" run.
 * With ?runId=N returns that run (including its per-article log); otherwise
 * returns the most recent run so a freshly-opened browser can pick up an
 * in-flight job.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");

  if (runId) {
    const result = await db.execute({
      sql: `SELECT id, status, total, done, succeeded, failed, current_title,
                   error_message, log, started_at, finished_at
            FROM summarise_runs WHERE id = ?`,
      args: [runId],
    });
    if (result.rows.length === 0) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }
    const row = result.rows[0];
    return Response.json({ ...row, log: JSON.parse(String(row.log ?? "[]")) });
  }

  const result = await db.execute(
    `SELECT id, status, total, done, succeeded, failed, current_title,
            error_message, started_at, finished_at
     FROM summarise_runs ORDER BY id DESC LIMIT 1`,
  );
  if (result.rows.length === 0) {
    return Response.json({ run: null });
  }
  return Response.json({ run: result.rows[0] });
}
