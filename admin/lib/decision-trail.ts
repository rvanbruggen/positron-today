/**
 * Loads decision-log trails for display in the admin (History, Rejections).
 */

import db from "./db";
import type { PromptVersionInfo, TrailStep, Trails } from "./decision-types";

/** URLs per query; SQLite's bound-parameter limit is far above this. */
const CHUNK = 500;

/**
 * Prompt versions with short labels: P1, P2, … for filter prompts and S1, S2, …
 * for summarise styles, numbered in the order they were first used.
 */
export async function loadPromptVersions(): Promise<Map<number, PromptVersionInfo>> {
  const res = await db.execute(`
    SELECT id, kind, created_at,
           ROW_NUMBER() OVER (PARTITION BY kind ORDER BY id) AS n
    FROM prompt_versions
  `);
  const map = new Map<number, PromptVersionInfo>();
  for (const r of res.rows) {
    const kind = String(r.kind);
    map.set(Number(r.id), {
      label: `${kind === "filter" ? "P" : "S"}${Number(r.n)}`,
      kind,
      firstSeen: String(r.created_at),
    });
  }
  return map;
}

/** Decision steps for each URL, oldest first. URLs with none are absent. */
export async function loadTrails(urls: string[]): Promise<{ trails: Trails; prompts: PromptVersionInfo[] }> {
  const versions = await loadPromptVersions();
  const trails: Trails = {};
  const unique = [...new Set(urls)];

  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const res = await db.execute({
      sql: `SELECT url, stage, actor, verdict, reason, category, score, provider, model,
                   prompt_version_id, call_path, run_id, app_version, created_at
            FROM decisions
            WHERE url IN (${chunk.map(() => "?").join(",")})
            ORDER BY id ASC`,
      args: chunk,
    });
    for (const r of res.rows) {
      const url = String(r.url);
      const step: TrailStep = {
        stage: String(r.stage),
        actor: String(r.actor) as TrailStep["actor"],
        verdict: String(r.verdict),
        reason: r.reason != null ? String(r.reason) : null,
        category: r.category != null ? String(r.category) : null,
        score: r.score != null ? Number(r.score) : null,
        provider: r.provider != null ? String(r.provider) : null,
        model: r.model != null ? String(r.model) : null,
        prompt: r.prompt_version_id != null ? versions.get(Number(r.prompt_version_id))?.label ?? null : null,
        callPath: r.call_path != null ? String(r.call_path) : null,
        runId: r.run_id != null ? Number(r.run_id) : null,
        appVersion: r.app_version != null ? String(r.app_version) : null,
        at: String(r.created_at),
      };
      (trails[url] ??= []).push(step);
    }
  }

  return { trails, prompts: [...versions.values()] };
}
