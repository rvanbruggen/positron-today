import { after } from "next/server";
import db from "@/lib/db";
import { selfFetch } from "@/lib/self-url";
import { runFetchChunk, runClassifyBatch, runExport, appendLog, updateRun } from "@/lib/pipeline-steps";

type StepPayload = {
  runId: number;
  phase: "fetch" | "classify" | "export";
  offset?: number;
};

function chainNext(payload: StepPayload) {
  after(async () => {
    try {
      const res = await selfFetch("/api/pipeline/step", payload);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Step self-call returned ${res.status}: ${body.slice(0, 200)}`);
      }
    } catch (err) {
      const msg = `Failed to chain next step: ${err}`;
      const current = await db.execute({
        sql: "SELECT log FROM pipeline_runs WHERE id = ?",
        args: [payload.runId],
      });
      const log: object[] = JSON.parse(String(current.rows[0]?.log ?? "[]"));
      log.push({ type: "fatal", message: msg });
      await db.execute({
        sql: `UPDATE pipeline_runs SET status = 'error', error_message = ?, log = ?, finished_at = datetime('now') WHERE id = ?`,
        args: [msg, JSON.stringify(log), payload.runId],
      });
    }
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as StepPayload;
  const { runId, phase, offset } = body;

  const run = await db.execute({
    sql: "SELECT status, phase, \"offset\", total_sources, sources_done FROM pipeline_runs WHERE id = ?",
    args: [runId],
  });
  if (run.rows.length === 0 || run.rows[0].status !== "running") {
    return Response.json({ skipped: true });
  }

  try {
    if (phase === "fetch") {
      await runFetchChunk(runId, offset ?? 0);
      // Check if fetch phase completed (runFetchChunk updates phase to "classify" when done)
      const updated = await db.execute({ sql: "SELECT phase, \"offset\" FROM pipeline_runs WHERE id = ?", args: [runId] });
      const newPhase = updated.rows[0]?.phase as string;
      const newOffset = Number(updated.rows[0]?.offset ?? 0);
      if (newPhase === "classify") {
        chainNext({ runId, phase: "classify" });
      } else {
        chainNext({ runId, phase: "fetch", offset: newOffset });
      }
    } else if (phase === "classify") {
      await runClassifyBatch(runId);
      const updated = await db.execute({ sql: "SELECT phase FROM pipeline_runs WHERE id = ?", args: [runId] });
      const newPhase = updated.rows[0]?.phase as string;
      if (newPhase === "export") {
        chainNext({ runId, phase: "export" });
      } else {
        chainNext({ runId, phase: "classify" });
      }
    } else if (phase === "export") {
      await runExport(runId);
      // Done — no chain needed
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
