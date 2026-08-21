/**
 * Necessary Negativity — manual controls.
 *
 * The weekly run is driven by the in-process scheduler, so this route is not
 * on the proxy's public path list: it stays behind the admin session cookie.
 *
 * GET  → what the generator would do right now (no LLM calls, no commit),
 *        including whether the target week has already been published
 * POST → { action: "run" }                  generate the last completed week
 *        { action: "run", week: "2026-W33" } generate one specific week
 *        { action: "backfill", weeks: 8 }    generate the last N weeks, oldest first
 *        add "force": true to regenerate a week that already exists
 *        add "dryRun": true to build the week and return it without committing
 */

import { NextRequest, NextResponse } from "next/server";
import {
  generateWeek,
  backfillWeeks,
  lastCompletedWeek,
  isoWeekOf,
  isWeekPublished,
} from "@/lib/never-skip";
import { getSettings } from "@/lib/settings";

/** Resolve a "YYYY-Www" key to its Monday/Sunday bounds. */
function weekFromKey(key: string): { week: string; start: string; end: string } | null {
  const m = key.trim().match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const weekNo = parseInt(m[2], 10);
  if (weekNo < 1 || weekNo > 53) return null;

  // ISO week 1 is the week containing 4 January.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const isoDow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (isoDow - 1));

  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (weekNo - 1) * 7);

  const resolved = isoWeekOf(target);
  return resolved.week === `${m[1]}-W${String(weekNo).padStart(2, "0")}` ? resolved : null;
}

export async function GET() {
  const settings = await getSettings();
  const wk = lastCompletedWeek();
  const published = await isWeekPublished(wk.week);
  return NextResponse.json({
    last_completed_week: wk,
    // true = published, false = not yet, null = the published file could not
    // be read, so this is unknown rather than "no".
    already_generated: published,
    schedule: settings.neverskip_run_time || "(disabled)",
    provider: settings.neverskip_provider,
    model: settings.neverskip_model,
    max_per_theme: settings.neverskip_count,
  });
}

export async function POST(req: NextRequest) {
  let body: { action?: string; week?: string; weeks?: number; force?: boolean; dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body → default action */
  }

  const action = body.action ?? "run";

  if (action === "backfill") {
    const count = Math.max(1, Math.min(52, Number(body.weeks) || 4));
    const results = await backfillWeeks(count);
    const failed = results.filter((r) => !r.ok);
    return NextResponse.json(
      {
        ok: failed.length === 0,
        requested: count,
        generated: results.filter((r) => r.ok && !r.skipped).length,
        skipped: results.filter((r) => r.skipped).length,
        results,
      },
      { status: failed.length ? 500 : 200 },
    );
  }

  if (action !== "run") {
    return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
  }

  let target = undefined;
  if (body.week) {
    const resolved = weekFromKey(body.week);
    if (!resolved) {
      return NextResponse.json(
        { ok: false, error: `Invalid week "${body.week}" — expected e.g. "2026-W33"` },
        { status: 400 },
      );
    }
    target = resolved;
  }

  const result = await generateWeek(target, { force: body.force === true, dryRun: body.dryRun === true });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
