import db from "./db";

export type LLMProvider = "anthropic" | "ollama";

export interface LLMSettings {
  filter_provider: LLMProvider;
  filter_model: string;
  summarise_provider: LLMProvider;
  summarise_model: string;
  ollama_base_url: string;
}

const DEFAULTS: LLMSettings = {
  filter_provider: "anthropic",
  filter_model: "claude-haiku-4-5-20251001",
  summarise_provider: "anthropic",
  summarise_model: "claude-sonnet-4-6",
  ollama_base_url: "http://localhost:11434",
};

export async function getSettings(): Promise<LLMSettings> {
  try {
    const result = await db.execute("SELECT key, value FROM settings");
    const map: Record<string, string> = {};
    for (const row of result.rows) {
      map[row.key as string] = row.value as string;
    }
    return {
      filter_provider: ((map.filter_provider as LLMProvider) || DEFAULTS.filter_provider),
      filter_model: map.filter_model || DEFAULTS.filter_model,
      summarise_provider: ((map.summarise_provider as LLMProvider) || DEFAULTS.summarise_provider),
      summarise_model: map.summarise_model || DEFAULTS.summarise_model,
      ollama_base_url: map.ollama_base_url || DEFAULTS.ollama_base_url,
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
