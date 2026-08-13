/**
 * Source confidence weights for Positronitron auto-selection.
 *
 * Computes a per-source "confidence weight" from historical editorial
 * decisions. The weight reflects how often the human editor approves
 * articles that the AI filter let through from a given source.
 *
 * Uses Bayesian smoothing so sources with few samples regress toward
 * the global average instead of getting extreme weights.
 *
 * Weights are recomputed and stored whenever the Positronitron mode
 * switches to "full" — a deliberate calibration step.
 */

import db from "@/lib/db";
import { setSetting } from "@/lib/settings";

const SETTINGS_KEY = "source_confidence_weights";
const PRIOR_WEIGHT = 10;

export interface SourceWeights {
  computed_at: string;
  global_confidence: number;
  weights: Record<string, number>;
}

export async function computeAndStoreWeights(): Promise<SourceWeights> {
  const [approvedResult, discardedResult] = await Promise.all([
    db.execute(`
      SELECT r.source_id, COUNT(*) as cnt
      FROM articles a
      JOIN raw_articles r ON a.raw_article_id = r.id
      WHERE r.source_id IS NOT NULL
      GROUP BY r.source_id
    `),
    db.execute(`
      SELECT source_id, COUNT(*) as cnt
      FROM rejected_articles
      WHERE rejection_category = 'human-discarded'
        AND source_id IS NOT NULL
      GROUP BY source_id
    `),
  ]);

  const approved: Record<number, number> = {};
  for (const row of approvedResult.rows) {
    approved[Number(row.source_id)] = Number(row.cnt);
  }

  const discarded: Record<number, number> = {};
  for (const row of discardedResult.rows) {
    discarded[Number(row.source_id)] = Number(row.cnt);
  }

  const allSourceIds = new Set([
    ...Object.keys(approved).map(Number),
    ...Object.keys(discarded).map(Number),
  ]);

  let totalApproved = 0;
  let totalPool = 0;
  for (const sid of allSourceIds) {
    const app = approved[sid] ?? 0;
    const disc = discarded[sid] ?? 0;
    totalApproved += app;
    totalPool += app + disc;
  }

  const globalConfidence = totalPool > 0 ? totalApproved / totalPool : 0.5;

  const weights: Record<string, number> = {};
  for (const sid of allSourceIds) {
    const app = approved[sid] ?? 0;
    const disc = discarded[sid] ?? 0;
    const pool = app + disc;
    const smoothed = (app + PRIOR_WEIGHT * globalConfidence) / (pool + PRIOR_WEIGHT);
    weights[String(sid)] = Math.round((smoothed / globalConfidence) * 1000) / 1000;
  }

  const result: SourceWeights = {
    computed_at: new Date().toISOString(),
    global_confidence: Math.round(globalConfidence * 1000) / 1000,
    weights,
  };

  await setSetting("source_confidence_weights" as never, JSON.stringify(result));
  console.log(
    `[source-confidence] Computed weights for ${allSourceIds.size} sources ` +
    `(global confidence: ${(globalConfidence * 100).toFixed(1)}%, ` +
    `${totalApproved} approved / ${totalPool} AI-approved pool)`,
  );

  return result;
}

export async function getStoredWeights(): Promise<SourceWeights | null> {
  try {
    const result = await db.execute({
      sql: "SELECT value FROM settings WHERE key = ?",
      args: [SETTINGS_KEY],
    });
    if (!result.rows[0]?.value) return null;
    return JSON.parse(String(result.rows[0].value)) as SourceWeights;
  } catch {
    return null;
  }
}

export function getWeight(weights: SourceWeights | null, sourceId: number): number {
  if (!weights) return 1.0;
  return weights.weights[String(sourceId)] ?? 1.0;
}
