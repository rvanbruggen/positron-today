/**
 * Positronitron — Autonomous Publishing Pipeline
 *
 * GET  /api/positronitron — status check (enabled? last run?)
 * POST /api/positronitron — run the pipeline
 *
 * Core logic is in lib/positronitron-core.ts; this route is a thin wrapper
 * that handles HTTP request/response concerns.
 */

import { getSettings } from "@/lib/settings";
import { runPositronitron } from "@/lib/positronitron-core";

export async function GET() {
  const settings = await getSettings();
  return Response.json({
    mode: settings.positronitron_mode,
    enabled: settings.positronitron_mode === "full",
    count: parseInt(settings.positronitron_count) || 3,
  });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const isManual = url.searchParams.get("manual") === "1";

  const result = await runPositronitron({ isManual });

  if (result.error) {
    return Response.json(result, { status: 500 });
  }
  return Response.json(result);
}
