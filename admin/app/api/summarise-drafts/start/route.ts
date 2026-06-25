import {
  runSummariseDrafts,
  isSummariseDraftsRunning,
  getActiveSummariseRunId,
} from "@/lib/summarise-core";

/**
 * Kick off a server-side "summarise all drafts" run and return immediately.
 * The work continues on the server regardless of whether the browser stays
 * connected — the client polls /api/summarise-drafts/status to watch progress.
 */
export async function POST() {
  if (isSummariseDraftsRunning()) {
    return Response.json(
      { error: "Summarisation already running", runId: getActiveSummariseRunId() },
      { status: 409 },
    );
  }

  // Start in the background — do NOT await the full run.
  const runIdPromise = runSummariseDrafts();

  // Wait briefly so the run row exists and we can report its id.
  await new Promise((r) => setTimeout(r, 200));
  const runId = getActiveSummariseRunId();

  runIdPromise.catch((err) => console.error("[summarise-drafts/start] Background error:", err));

  return Response.json({ runId });
}
