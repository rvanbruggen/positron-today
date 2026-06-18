import { getSettings } from "@/lib/settings";
import { runUnifiedPipeline, isUnifiedPipelineRunning, getActiveRunId } from "@/lib/unified-pipeline";

export async function POST() {
  const settings = await getSettings();
  if (settings.positronitron_mode === "off") {
    return Response.json({ error: "Positronitron is off." }, { status: 409 });
  }

  if (isUnifiedPipelineRunning()) {
    return Response.json({ error: "Pipeline already running", runId: getActiveRunId() }, { status: 409 });
  }

  // Start the pipeline in the background and return immediately
  const runIdPromise = runUnifiedPipeline({ isManual: true });

  // Wait briefly for the run to be created so we can return the runId
  await new Promise(r => setTimeout(r, 200));
  const runId = getActiveRunId();

  // Don't await the full pipeline — it runs in the background
  runIdPromise.catch(err => console.error("[pipeline/start] Background error:", err));

  return Response.json({ runId });
}
