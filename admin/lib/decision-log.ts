/**
 * Decision log — provenance for every editorial decision about an article.
 *
 * Each accept, reject, pick or summary appends one row to `decisions`, saying
 * who or what made it (llm / human / rule), at which stage, and — for model
 * decisions — which provider, model and prompt version. An article collects
 * several rows over its life (filter accepts it, a human discards it, …), and
 * nothing is ever overwritten, so a later re-categorisation or a restore from
 * the Rejections page does not erase the original verdict.
 *
 * Prompt versions cover the EDITABLE part of a prompt only: the filter
 * instructions and the summarise style, whether default or overridden in
 * Settings. The scaffolding around them lives in code and is identified by
 * `app_version`. Versions are content-addressed: any change to the text gets a
 * new row automatically, with no manual numbering.
 *
 * Logging must never break the pipeline, so every write here swallows its own
 * errors.
 *
 * Joining: `decisions.url` matches raw_articles.url, rejected_articles.url and
 * articles.source_url. `run_id` refers to pipeline_runs.
 */

import { createHash } from "crypto";
import db from "./db";
import { APP_VERSION } from "./version";

export type PromptKind = "filter" | "summarise";

export type DecisionStage =
  | "filter"          // positivity filter: accept / reject
  | "fold"            // story folding: join / discard
  | "review"          // Preview page, Rejections-page restore, manual URL
  | "positronitron"   // automatic pick from the queue
  | "summarise"       // summary card written
  | "backfill";       // rejection re-categorised

export type DecisionActor = "llm" | "human" | "rule";

export interface Decision {
  url: string;
  stage: DecisionStage;
  actor: DecisionActor;
  verdict: string;
  reason?: string | null;
  category?: string | null;
  score?: number | null;
  /** Provider and model that made the call; pass an LLMProvider's own fields. */
  provider?: string | null;
  model?: string | null;
  promptVersionId?: number | null;
  /** How the model was called, e.g. "batch" / "single" for the filter. */
  callPath?: string | null;
  runId?: number | null;
}

/**
 * Id of this prompt text in `prompt_versions`, inserting it on first sight.
 * Returns null (and logs) if the lookup fails — decisions are still recorded,
 * just without the link.
 */
export async function promptVersionId(kind: PromptKind, text: string): Promise<number | null> {
  const sha = createHash("sha256").update(text).digest("hex");
  try {
    await db.execute({
      sql: "INSERT OR IGNORE INTO prompt_versions (kind, sha256, text) VALUES (?, ?, ?)",
      args: [kind, sha, text],
    });
    const res = await db.execute({
      sql: "SELECT id FROM prompt_versions WHERE kind = ? AND sha256 = ?",
      args: [kind, sha],
    });
    return res.rows[0] ? Number(res.rows[0].id) : null;
  } catch (err) {
    console.warn(`[decision-log] prompt version lookup failed: ${err}`);
    return null;
  }
}

/** Append one decision. Never throws. */
export async function recordDecision(d: Decision): Promise<void> {
  try {
    await db.execute({
      sql: `INSERT INTO decisions
              (url, stage, actor, verdict, reason, category, score,
               provider, model, prompt_version_id, call_path, run_id, app_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        d.url, d.stage, d.actor, d.verdict,
        d.reason ?? null, d.category ?? null, d.score ?? null,
        d.provider ?? null, d.model ?? null, d.promptVersionId ?? null,
        d.callPath ?? null, d.runId ?? null, APP_VERSION,
      ],
    });
  } catch (err) {
    console.warn(`[decision-log] could not record ${d.stage}/${d.verdict} for ${d.url}: ${err}`);
  }
}
