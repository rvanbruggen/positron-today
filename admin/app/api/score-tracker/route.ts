import { NextResponse } from "next/server";
import { runScoreTracker } from "@/lib/score-tracker";

export async function POST() {
  try {
    const result = await runScoreTracker();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    description: "POST to trigger a score collection run for all tracked sources",
  });
}
