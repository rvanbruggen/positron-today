/**
 * LLM provider abstraction.
 *
 * Two implementations:
 *   - AnthropicProvider  — calls the Anthropic API (current default)
 *   - OllamaProvider     — calls a local Ollama instance via its OpenAI-compatible API
 *
 * Use getFilterProvider() / getSummariseProvider() to get the right provider
 * based on the current settings (read from DB at call time, so changes apply immediately).
 */

import Anthropic from "@anthropic-ai/sdk";
import { getSettings, type LLMSettings } from "./settings";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ClassifyResult {
  fits: boolean;
  reason: string;
}

export interface LLMProvider {
  /** Binary classification — used for the positivity filter. */
  classify(prompt: string, systemPrompt?: string): Promise<ClassifyResult>;

  /** Free-form generation — used for summarisation. Returns raw text. */
  generate(prompt: string, systemPrompt?: string, maxTokens?: number): Promise<string>;
}

// ---------------------------------------------------------------------------
// Anthropic implementation
// ---------------------------------------------------------------------------

const anthropic = new Anthropic();

const ANTHROPIC_MODELS: Record<string, string> = {
  "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-opus-4-5": "claude-opus-4-5",
};

class AnthropicProvider implements LLMProvider {
  constructor(private model: string) {}

  async classify(prompt: string): Promise<ClassifyResult> {
    const message = await anthropic.messages.create({
      model: this.model,
      max_tokens: 80,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (message.content[0] as { type: string; text: string }).text.trim();
    return parseClassifyResponse(raw);
  }

  async generate(prompt: string, systemPrompt?: string, maxTokens = 1200): Promise<string> {
    const message = await anthropic.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }],
    });
    return (message.content[0] as { type: string; text: string }).text.trim();
  }
}

// ---------------------------------------------------------------------------
// Ollama implementation (OpenAI-compatible /v1/chat/completions endpoint)
// ---------------------------------------------------------------------------

class OllamaProvider implements LLMProvider {
  constructor(
    private model: string,
    private baseUrl: string,
  ) {}

  private get endpoint() {
    return `${this.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  }

  async classify(prompt: string): Promise<ClassifyResult> {
    const raw = await this.callOllama(prompt, undefined, 120);
    return parseClassifyResponse(raw);
  }

  async generate(prompt: string, systemPrompt?: string, maxTokens = 1200): Promise<string> {
    return this.callOllama(prompt, systemPrompt, maxTokens);
  }

  private async callOllama(
    userPrompt: string,
    systemPrompt: string | undefined,
    maxTokens: number,
  ): Promise<string> {
    const messages: { role: string; content: string }[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userPrompt });

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: maxTokens,
        stream: false,
        options: { temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    return (data.choices?.[0]?.message?.content ?? "").trim();
  }
}

// ---------------------------------------------------------------------------
// Shared response parser
// ---------------------------------------------------------------------------

function parseClassifyResponse(raw: string): ClassifyResult {
  try {
    const parsed = JSON.parse(raw);
    return {
      fits: parsed.verdict === "YES",
      reason: parsed.reason || (parsed.verdict === "NO" ? "does not fit positive news criteria" : ""),
    };
  } catch {
    const fits = raw.toUpperCase().includes('"YES"') || raw.toUpperCase().startsWith("YES");
    return { fits, reason: fits ? "" : "does not fit positive news criteria" };
  }
}

// ---------------------------------------------------------------------------
// Factory functions — read settings from DB each call
// ---------------------------------------------------------------------------

export async function getFilterProvider(): Promise<LLMProvider> {
  const settings = await getSettings();
  return buildProvider(settings, "filter");
}

export async function getSummariseProvider(): Promise<LLMProvider> {
  const settings = await getSettings();
  return buildProvider(settings, "summarise");
}

function buildProvider(settings: LLMSettings, task: "filter" | "summarise"): LLMProvider {
  const provider = task === "filter" ? settings.filter_provider : settings.summarise_provider;
  const model    = task === "filter" ? settings.filter_model    : settings.summarise_model;

  if (provider === "ollama") {
    return new OllamaProvider(model, settings.ollama_base_url);
  }
  // Default: anthropic
  return new AnthropicProvider(ANTHROPIC_MODELS[model] ?? model);
}

// ---------------------------------------------------------------------------
// Exported constants for the settings UI
// ---------------------------------------------------------------------------

export const ANTHROPIC_MODEL_OPTIONS = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast, cheap)" },
  { value: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6 (balanced)" },
  { value: "claude-opus-4-5",           label: "Claude Opus 4.5 (best quality)" },
];
