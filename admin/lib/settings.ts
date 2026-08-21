import db from "./db";

export type LLMProvider = "anthropic" | "ollama" | "openai";

/**
 * Positronitron automation mode.
 * - off       — nothing automated
 * - fetch     — fetch + classify only
 * - summarise — fetch + classify + positronitron picks & summarises top N as drafts
 * - full      — fetch + classify + positronitron + publish + social
 */
export type PositronitronMode = "off" | "fetch" | "summarise" | "full";

const POSITRONITRON_MODES: PositronitronMode[] = ["off", "fetch", "summarise", "full"];

export interface LLMSettings {
  filter_provider: LLMProvider;
  filter_model: string;
  summarise_provider: LLMProvider;
  summarise_model: string;
  ollama_base_url: string;
  /** If non-empty, overrides the default filter instructions */
  filter_prompt_override: string;
  /** If non-empty, overrides the default summarisation voice/style block */
  summarise_style_override: string;
  /** Positronitron automation mode — see PositronitronMode */
  positronitron_mode: PositronitronMode;
  /** Number of articles to select per Positronitron run (stringified integer) */
  positronitron_count: string;
  /** JSON array of "HH:MM" strings — daily run times for Positronitron */
  positronitron_run_times: string;
  /** JSON array of "HH:MM" strings — daily run times for digest social posts */
  digest_run_times: string;
  /** Provider + model for the weekly Necessary Negativity ranking and rendering */
  neverskip_provider: LLMProvider;
  neverskip_model: string;
  /** "" disables the weekly run. Otherwise "D HH:MM" where D is 0-6, Sunday=0. */
  neverskip_run_time: string;
  /** Max stories published per theme per week (stringified integer) */
  neverskip_count: string;
}

const DEFAULTS: LLMSettings = {
  filter_provider: "anthropic",
  filter_model: "claude-haiku-4-5-20251001",
  summarise_provider: "anthropic",
  summarise_model: "claude-sonnet-5",
  ollama_base_url: "http://localhost:11434",
  filter_prompt_override: "",
  summarise_style_override: "",
  positronitron_mode: "off",
  positronitron_count: "3",
  positronitron_run_times: '["08:00","15:00"]',
  digest_run_times: '[]',
  // Selecting the consequential few out of ~500 weekly candidates is an open
  // judgement call, not a rule check — a weaker model measurably picks worse
  // (it passed over a global AI moratorium in favour of a single lawsuit).
  // Six calls a week keeps the cost of the strong default negligible; change
  // it in Settings if that stops being true.
  neverskip_provider: "anthropic",
  neverskip_model: "claude-opus-5",
  neverskip_run_time: "",
  neverskip_count: "5",
};

export async function getSettings(): Promise<LLMSettings> {
  try {
    const result = await db.execute("SELECT key, value FROM settings");
    const map: Record<string, string> = {};
    for (const row of result.rows) {
      map[row.key as string] = row.value as string;
    }

    // Resolve mode: prefer new key; fall back to legacy positronitron_enabled flag
    // so existing deployments migrate transparently on first read.
    let mode: PositronitronMode = DEFAULTS.positronitron_mode;
    if (map.positronitron_mode && POSITRONITRON_MODES.includes(map.positronitron_mode as PositronitronMode)) {
      mode = map.positronitron_mode as PositronitronMode;
    } else if (map.positronitron_enabled === "true") {
      mode = "full";
    }

    return {
      filter_provider:          ((map.filter_provider as LLMProvider) || DEFAULTS.filter_provider),
      filter_model:             map.filter_model             || DEFAULTS.filter_model,
      summarise_provider:       ((map.summarise_provider as LLMProvider) || DEFAULTS.summarise_provider),
      summarise_model:          map.summarise_model          || DEFAULTS.summarise_model,
      ollama_base_url:          map.ollama_base_url          || DEFAULTS.ollama_base_url,
      // overrides: empty string is a valid "not set" value — preserve it
      filter_prompt_override:   map.filter_prompt_override   ?? DEFAULTS.filter_prompt_override,
      summarise_style_override: map.summarise_style_override ?? DEFAULTS.summarise_style_override,
      positronitron_mode:       mode,
      positronitron_count:      map.positronitron_count       || DEFAULTS.positronitron_count,
      positronitron_run_times:  map.positronitron_run_times   || DEFAULTS.positronitron_run_times,
      digest_run_times:         map.digest_run_times          || DEFAULTS.digest_run_times,
      neverskip_provider:       ((map.neverskip_provider as LLMProvider) || DEFAULTS.neverskip_provider),
      neverskip_model:          map.neverskip_model           || DEFAULTS.neverskip_model,
      neverskip_run_time:       map.neverskip_run_time        ?? DEFAULTS.neverskip_run_time,
      neverskip_count:          map.neverskip_count           || DEFAULTS.neverskip_count,
    };
  } catch {
    // Table may not exist yet (migration pending) — return defaults
    return { ...DEFAULTS };
  }
}

export async function setSetting(key: keyof LLMSettings, value: string): Promise<void> {
  await db.execute({
    sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, value],
  });
}

export async function setSettings(patch: Partial<LLMSettings>): Promise<void> {
  for (const [key, value] of Object.entries(patch)) {
    await setSetting(key as keyof LLMSettings, value as string);
  }
}
