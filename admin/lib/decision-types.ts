/**
 * Shapes and display helpers for the decision log (see decision-log.ts), shared
 * by the server loader (decision-trail.ts) and the admin UI. No database
 * imports here, so client components can use it.
 */

export interface TrailStep {
  stage: string;
  actor: "llm" | "human" | "rule";
  verdict: string;
  reason: string | null;
  category: string | null;
  score: number | null;
  provider: string | null;
  model: string | null;
  /** Short prompt-version label, e.g. "P2" (filter) or "S1" (summarise style). */
  prompt: string | null;
  callPath: string | null;
  runId: number | null;
  appVersion: string | null;
  /** SQLite UTC timestamp, "YYYY-MM-DD HH:MM:SS". */
  at: string;
}

export interface PromptVersionInfo {
  label: string;
  kind: string;
  firstSeen: string;
}

/** Decision steps per article URL, oldest first. */
export type Trails = Record<string, TrailStep[]>;

/** Filter value for articles decided before the log existed. */
export const NOT_LOGGED = "__not_logged__";

/** The release that started the log, for the "before logging" hint. */
export const LOG_STARTED = "v4.6.0 (23 Sep 2026)";

const MODEL_NAMES: Record<string, string> = {
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "claude-haiku-4-5": "Haiku 4.5",
  "claude-sonnet-5": "Sonnet 5",
  "claude-opus-5": "Opus 5",
};

/** "claude-sonnet-5" → "Sonnet 5"; unknown ids are shown as they are. */
export function prettyModel(model: string | null): string {
  if (!model) return "";
  if (MODEL_NAMES[model]) return MODEL_NAMES[model];
  const m = /^claude-([a-z]+)-([\d-]+?)(?:-\d{8})?$/.exec(model);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace(/-/g, ".")}`;
  return model;
}

export type StepTone = "accept" | "reject" | "neutral";

/** One compact chip: icon, short text and colour tone. */
export function stepChip(s: TrailStep): { icon: string; text: string; tone: StepTone } {
  const model = prettyModel(s.model);
  const withPrompt = (t: string) => (s.prompt ? `${t} · ${s.prompt}` : t);
  switch (s.stage) {
    case "filter":
      return { icon: "🤖", text: withPrompt(model || "filter"), tone: s.verdict === "reject" ? "reject" : "accept" };
    case "fold":
      return { icon: "🔗", text: s.verdict === "join" ? "joined story" : "folded", tone: s.verdict === "discard" ? "reject" : "neutral" };
    case "review": {
      const text =
        s.verdict === "approve" ? "approved" :
        s.verdict === "discard" ? "discarded" :
        s.verdict === "restore" ? "restored" :
        s.verdict === "manual_add" ? "added manually" : s.verdict;
      return { icon: "🙋", text, tone: s.verdict === "discard" ? "reject" : "accept" };
    }
    case "positronitron":
      return { icon: "⚙️", text: "auto-picked", tone: "accept" };
    case "summarise":
      return { icon: "✍️", text: withPrompt(model || "summarised"), tone: "neutral" };
    case "backfill":
      return { icon: "🏷️", text: "recategorised", tone: "neutral" };
    default:
      return { icon: "•", text: `${s.stage} ${s.verdict}`, tone: "neutral" };
  }
}

/** Longer one-line description of a step, for the hover detail. */
export function stepDetail(s: TrailStep): string {
  const who =
    s.actor === "human" ? "You" :
    s.actor === "rule" ? "Rule" :
    [s.provider, s.model].filter(Boolean).join(" / ") || "Model";
  const parts = [`${who}: ${s.stage} → ${s.verdict}`];
  if (s.prompt) parts.push(`prompt ${s.prompt}`);
  if (s.callPath) parts.push(s.callPath);
  if (s.score != null) parts.push(`score ${Math.round(s.score * 10) / 10}`);
  if (s.runId != null) parts.push(`run #${s.runId}`);
  return parts.join(" · ");
}

/** Every model and prompt label appearing in a set of trails, for filter dropdowns. */
export function trailFacets(trails: Trails): { models: string[]; prompts: string[] } {
  const models = new Set<string>();
  const prompts = new Set<string>();
  for (const steps of Object.values(trails)) {
    for (const s of steps) {
      if (s.model) models.add(s.model);
      if (s.prompt) prompts.add(s.prompt);
    }
  }
  const byLabel = (a: string, b: string) =>
    a[0] === b[0] ? Number(a.slice(1)) - Number(b.slice(1)) : a.localeCompare(b);
  return { models: [...models].sort(), prompts: [...prompts].sort(byLabel) };
}

/**
 * Does an article's trail match the model / prompt filters? "all" matches
 * everything; NOT_LOGGED matches only articles with no logged decisions.
 */
export function trailMatches(steps: TrailStep[] | undefined, model: string, prompt: string): boolean {
  const list = steps ?? [];
  for (const f of [model, prompt]) {
    if (f === NOT_LOGGED && list.length > 0) return false;
  }
  if (model !== "all" && model !== NOT_LOGGED && !list.some((s) => s.model === model)) return false;
  if (prompt !== "all" && prompt !== NOT_LOGGED && !list.some((s) => s.prompt === prompt)) return false;
  return true;
}
