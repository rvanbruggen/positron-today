import { getSettings } from "@/lib/settings";
import { startPipelineRun } from "@/lib/pipeline-steps";
import { ensureWorkerRunning } from "@/lib/pipeline-worker";

export async function POST() {
  const settings = await getSettings();
  if (settings.positronitron_mode === "off") {
    return Response.json({ error: "Positronitron is off." }, { status: 409 });
  }

  const result = await startPipelineRun();

  if ("error" in result) {
    if (result.runId) ensureWorkerRunning(result.runId);
    return Response.json(result, { status: 409 });
  }

  ensureWorkerRunning(result.runId);
  return Response.json({ runId: result.runId });
}
