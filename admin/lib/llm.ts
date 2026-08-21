/**
 * LLM provider abstraction.
 *
 * Three implementations:
 *   - AnthropicProvider  — calls the Anthropic API (current default)
 *   - OllamaProvider     — calls a local Ollama instance via its OpenAI-compatible API
 *   - OpenAIProvider     — calls the OpenAI ChatGPT API
 *
 * Use getFilterProvider() / getSummariseProvider() to get the right provider
 * based on the current settings (read from DB at call time, so changes apply immediately).
 */

import Anthropic from "@anthropic-ai/sdk";
import { getSettings, type LLMSettings } from "./settings";
import { withRetry } from "@/lib/retry";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ClassifyResult {
  fits: boolean;
  reason: string;
  category?: string;   // rejection category slug, present only when fits === false
  score?: number;      // positivity score 1-10, present when the LLM returns one
  // English preview translation, present when buildFilterPrompt was called with
  // translateToEnglish=true (i.e. the source language is not en/nl/fr).
  preview_title_en?: string;
  preview_snippet_en?: string;
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

/**
 * Claude models from the 4.6 generation onward reject `temperature` (and the
 * other sampling parameters) with a 400. Older ones still accept it, and the
 * filter relies on temperature 0 for stable verdicts, so it is sent only where
 * it is valid rather than dropped everywhere.
 */
function acceptsSampling(model: string): boolean {
  return !/^claude-(fable-5|mythos-5|opus-(5|4-[678])|sonnet-(5|4-6))/.test(model);
}

/**
 * Pull the answer text out of a response.
 *
 * Thinking-enabled models put a `thinking` block first, so `content[0]` is not
 * reliably the answer — on Claude Opus 5, where thinking is on by default,
 * reading `content[0].text` yields undefined.
 */
function textOf(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
}

const ANTHROPIC_MODELS: Record<string, string> = {
  "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
  "claude-sonnet-5": "claude-sonnet-5",
  "claude-opus-5": "claude-opus-5",
};

class AnthropicProvider implements LLMProvider {
  constructor(private model: string) {}

  async classify(prompt: string): Promise<ClassifyResult> {
    const message = await anthropic.messages.create({
      model: this.model,
      // Thinking models spend part of the budget before writing any text, so a
      // 200-token cap would truncate the verdict away entirely.
      max_tokens: acceptsSampling(this.model) ? 200 : 2000,
      ...(acceptsSampling(this.model) ? { temperature: 0 } : {}),
      messages: [{ role: "user", content: prompt }],
    });
    return parseClassifyResponse(textOf(message));
  }

  async generate(prompt: string, systemPrompt?: string, maxTokens = 1200): Promise<string> {
    const message = await anthropic.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }],
    });
    return textOf(message);
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
    const raw = await this.callOllama(prompt, undefined, 120, 0);
    return parseClassifyResponse(raw);
  }

  async generate(prompt: string, systemPrompt?: string, maxTokens = 1200): Promise<string> {
    return this.callOllama(prompt, systemPrompt, maxTokens, 0.3);
  }

  private async callOllama(
    userPrompt: string,
    systemPrompt: string | undefined,
    maxTokens: number,
    temperature: number,
  ): Promise<string> {
    const messages: { role: string; content: string }[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userPrompt });

    return withRetry(async () => {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: maxTokens,
          stream: false,
          options: { temperature },
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      return (data.choices?.[0]?.message?.content ?? "").trim();
    }, { label: `Ollama ${this.model}`, baseDelayMs: 1000 });
  }
}

// ---------------------------------------------------------------------------
// OpenAI implementation
// ---------------------------------------------------------------------------

class OpenAIProvider implements LLMProvider {
  private readonly endpoint = "https://api.openai.com/v1/chat/completions";

  constructor(private model: string) {}

  async classify(prompt: string): Promise<ClassifyResult> {
    const raw = await this.call(prompt, undefined, 200, 0);
    return parseClassifyResponse(raw);
  }

  async generate(prompt: string, systemPrompt?: string, maxTokens = 1200): Promise<string> {
    return this.call(prompt, systemPrompt, maxTokens, 0.3);
  }

  private async call(
    userPrompt: string,
    systemPrompt: string | undefined,
    maxTokens: number,
    temperature: number,
  ): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set in .env.local");

    const messages: { role: string; content: string }[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userPrompt });

    // OpenAI reasoning models (o1*, o3*, …) reject `temperature` and `top_p`
    // and require `max_completion_tokens` instead of `max_tokens`. Detect by
    // the canonical "o<digit>" prefix so future o-series releases work too.
    const isReasoningModel = /^o[1-9]/i.test(this.model);
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
    };
    if (isReasoningModel) {
      body.max_completion_tokens = maxTokens;
    } else {
      body.max_tokens = maxTokens;
      body.temperature = temperature;
    }

    return withRetry(async () => {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      return (data.choices?.[0]?.message?.content ?? "").trim();
    }, { label: `OpenAI ${this.model}`, baseDelayMs: 1000 });
  }
}

// ---------------------------------------------------------------------------
// Shared response parser
// ---------------------------------------------------------------------------

function parseClassifyResponse(raw: string): ClassifyResult {
  // Strip markdown code fences if the model wrapped the JSON
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : cleaned;
  try {
    const parsed = JSON.parse(jsonStr);
    const rawReason = parsed.reason;
    const reason = typeof rawReason === "string" && rawReason.trim()
      ? rawReason.trim()
      : typeof rawReason === "object" && rawReason !== null
        ? Object.values(rawReason).join("; ")   // flatten {"Health Scare": "desc"} → "desc"
        : (parsed.verdict === "NO" ? "does not fit positive news criteria" : "");
    const rawScore = Number(parsed.score);
    const score = rawScore >= 1 && rawScore <= 10 ? rawScore : undefined;
    const preview_title_en = typeof parsed.preview_title_en === "string" && parsed.preview_title_en.trim()
      ? parsed.preview_title_en.trim()
      : undefined;
    const preview_snippet_en = typeof parsed.preview_snippet_en === "string" && parsed.preview_snippet_en.trim()
      ? parsed.preview_snippet_en.trim()
      : undefined;
    return {
      fits: parsed.verdict === "YES",
      reason,
      category: parsed.verdict === "NO" ? (parsed.category ?? "other-negative") : undefined,
      score,
      preview_title_en,
      preview_snippet_en,
    };
  } catch {
    const fits = raw.toUpperCase().includes('"YES"') || raw.toUpperCase().startsWith("YES");
    return { fits, reason: fits ? "" : "does not fit positive news criteria", category: fits ? undefined : "other-negative" };
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

/** Provider for the weekly Necessary Negativity ranking + rendering. */
export async function getNeverSkipProvider(): Promise<LLMProvider> {
  const settings = await getSettings();
  return buildProvider(settings, "neverskip");
}

type LLMTask = "filter" | "summarise" | "neverskip";

const OLLAMA_DEFAULT_MODELS: Record<LLMTask, string> = {
  filter: "llama3.2:3b",
  summarise: "gemma3:27b",
  neverskip: "gemma3:27b",
};

const OPENAI_DEFAULT_MODELS: Record<LLMTask, string> = {
  filter: "gpt-4.1-mini",
  summarise: "gpt-4.1",
  neverskip: "gpt-4.1",
};

const ANTHROPIC_DEFAULT_MODELS: Record<LLMTask, string> = {
  filter: "claude-haiku-4-5-20251001",
  summarise: "claude-sonnet-5",
  neverskip: "claude-opus-5",
};

function isAnthropicModelName(model: string): boolean {
  return model.startsWith("claude-");
}

function isOpenAIModelName(model: string): boolean {
  return model.startsWith("gpt-") || /^o[1-9]/i.test(model);
}

function buildProvider(settings: LLMSettings, task: LLMTask): LLMProvider {
  const provider =
    task === "filter"    ? settings.filter_provider :
    task === "neverskip" ? settings.neverskip_provider :
                           settings.summarise_provider;
  const rawModel =
    task === "filter"    ? settings.filter_model :
    task === "neverskip" ? settings.neverskip_model :
                           settings.summarise_model;

  if (provider === "openai") {
    const model =
      !rawModel || isAnthropicModelName(rawModel)
        ? OPENAI_DEFAULT_MODELS[task]
        : rawModel;
    return new OpenAIProvider(model);
  }

  if (provider === "ollama") {
    // Guard 1: empty model stored → use sensible Ollama default
    // Guard 2: Anthropic/OpenAI model name stored while provider is Ollama (mismatched settings)
    //          → swap to Ollama default instead of sending "claude-*" or "gpt-*" to Ollama
    const model =
      !rawModel || isAnthropicModelName(rawModel) || isOpenAIModelName(rawModel)
        ? OLLAMA_DEFAULT_MODELS[task]
        : rawModel;
    return new OllamaProvider(model, settings.ollama_base_url || "http://localhost:11434");
  }

  // Default: anthropic
  const model = rawModel || ANTHROPIC_DEFAULT_MODELS[task];
  return new AnthropicProvider(ANTHROPIC_MODELS[model] ?? model);
}

// ---------------------------------------------------------------------------
// Exported constants for the settings UI
// ---------------------------------------------------------------------------

export const ANTHROPIC_MODEL_OPTIONS = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast, cheap)" },
  { value: "claude-sonnet-5",           label: "Claude Sonnet 5 (balanced)" },
  { value: "claude-opus-5",             label: "Claude Opus 5 (best quality)" },
];

export const OPENAI_MODEL_OPTIONS = [
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini (fast, cheap)" },
  { value: "gpt-4.1",      label: "GPT-4.1 (balanced)" },
  { value: "o4-mini",      label: "o4-mini (reasoning, fast)" },
  { value: "o3",           label: "o3 (reasoning, best quality)" },
];
