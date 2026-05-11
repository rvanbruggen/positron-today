import db from "@/lib/db";
import { runFetchChunk, runClassifyBatch, runExport, appendLog, updateRun } from "@/lib/pipeline-steps";

type StepPayload = {
  runId: number;
  phase: "fetch" | "classify" | "export";
  offset?: number;
};

export async function POST(request: Request) {
  const body = (await request.json()) as StepPayload;
  const { runId, phase, offset } = body;

  const run = await db.execute({
    sql: "SELECT status FROM pipeline_runs WHERE id = ?",
    args: [runId],
  });
  if (run.rows.length === 0 || run.rows[0].status !== "running") {
    return Response.json({ skipped: true });
  }

  try {
    if (phase === "fetch") {
      await runFetchChunk(runId, offset ?? 0);
    } else if (phase === "classify") {
      await runClassifyBatch(runId);
    } else if (phase === "export") {
      await runExport(runId);
    }
  } catch (err) {
    await appendLog(runId, [{ type: "fatal", message: String(err) }]);
    await updateRun(runId, {
      status: "error",
      error_message: String(err),
      finished_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    });
  }

  return Response.json({ ok: true });
}
