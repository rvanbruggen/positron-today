import db from "./db";

export type LLMProvider = "anthropic" | "ollama" | "openai";

export interface LLMSettings {
  filter_provider: LLMProvider;
  filter_model: string;
  summarise_provider: LLMProvider;
  summarise_model: string;
  ollama_base_url: string;
  /** 1–10 stringified; controls how strict the positivity filter prompt is */
  filter_threshold: string;
  /** If non-empty, overrides the auto-generated filter instructions entirely */
  filter_prompt_override: string;
  /** If non-empty, overrides the default summarisation voice/style block */
  summarise_style_override: string;
  /** "true" or "false" — master switch for autonomous publishing */
  positronitron_enabled: string;
  /** Number of articles to select per Positronitron run (stringified integer) */
  positronitron_count: string;
}

const DEFAULTS: LLMSettings = {
  filter_provider: "anthropic",
  filter_model: "claude-haiku-4-5-20251001",
  summarise_provider: "anthropic",
  summarise_model: "claude-sonnet-4-6",
  ollama_base_url: "http://localhost:11434",
  filter_threshold: "5",
  filter_prompt_override: "",
  summarise_style_override: "",
  positronitron_enabled: "false",
  positronitron_count: "3",
};

export async function getSettings(): Promise<LLMSettings> {
  try {
    const result = await db.execute("SELECT key, value FROM settings");
    const map: Record<string, string> = {};
    for (const row of result.rows) {
      map[row.key as string] = row.value as string;
    }
    return {
      filter_provider:          ((map.filter_provider as LLMProvider) || DEFAULTS.filter_provider),
      filter_model:             map.filter_model             || DEFAULTS.filter_model,
      summarise_provider:       ((map.summarise_provider as LLMProvider) || DEFAULTS.summarise_provider),
      summarise_model:          map.summarise_model          || DEFAULTS.summarise_model,
      ollama_base_url:          map.ollama_base_url          || DEFAULTS.ollama_base_url,
      filter_threshold:         map.filter_threshold         || DEFAULTS.filter_threshold,
      // overrides: empty string is a valid "not set" value — preserve it
      filter_prompt_override:   map.filter_prompt_override   ?? DEFAULTS.filter_prompt_override,
      summarise_style_override: map.summarise_style_override ?? DEFAULTS.summarise_style_override,
      positronitron_enabled:    map.positronitron_enabled     || DEFAULTS.positronitron_enabled,
      positronitron_count:      map.positronitron_count       || DEFAULTS.positronitron_count,
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
