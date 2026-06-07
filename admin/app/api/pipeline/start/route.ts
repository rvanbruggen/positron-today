import { getSettings } from "@/lib/settings";
import { startPipelineRun } from "@/lib/pipeline-steps";

export async function POST() {
  const settings = await getSettings();
  if (settings.positronitron_mode === "off") {
    return Response.json({ error: "Positronitron is off." }, { status: 409 });
  }

  const result = await startPipelineRun();

  if ("error" in result) {
    return Response.json(result, { status: 409 });
  }

  return Response.json({ runId: result.runId });
}
