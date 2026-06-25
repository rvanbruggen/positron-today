import { requestSummariseCancel, isSummariseDraftsRunning } from "@/lib/summarise-core";

/**
 * Request cancellation of the in-flight "summarise all drafts" run. The run
 * stops after the current article finishes; already-summarised drafts keep
 * their summaries.
 */
export async function POST() {
  const wasRunning = isSummariseDraftsRunning();
  requestSummariseCancel();
  return Response.json({ ok: true, wasRunning });
}
