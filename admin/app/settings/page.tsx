"use client";

import { useEffect, useState, useCallback } from "react";
import { buildFilterInstructions, DEFAULT_SUMMARISE_STYLE, THRESHOLD_LABELS } from "@/lib/prompts";

type Provider = "anthropic" | "ollama" | "openai";

interface LLMSettings {
  filter_provider: Provider;
  filter_model: string;
  summarise_provider: Provider;
  summarise_model: string;
  ollama_base_url: string;
  filter_threshold: string;
  filter_prompt_override: string;
  summarise_style_override: string;
}

const ANTHROPIC_MODELS = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fast & cheap" },
  { value: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6 — balanced" },
  { value: "claude-opus-4-5",           label: "Claude Opus 4.5 — best quality" },
];

const OPENAI_MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o mini — fast & cheap" },
  { value: "gpt-4o",      label: "GPT-4o — balanced" },
  { value: "o3-mini",     label: "o3-mini — reasoning, fast" },
  { value: "o3",          label: "o3 — reasoning, best quality" },
];

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic (cloud)",
  openai:    "OpenAI ChatGPT (cloud)",
  ollama:    "Ollama (local)",
};

function Badge({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-xs text-amber-400">checking…</span>;
  return ok
    ? <span className="text-xs text-green-600 font-medium">● reachable</span>
    : <span className="text-xs text-red-500 font-medium">● unreachable</span>;
}

export default function SettingsPage() {
  const [settings, setSettings]         = useState<LLMSettings | null>(null);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [saveMsg, setSaveMsg]           = useState<string | null>(null);
  const [ollamaOk, setOllamaOk]         = useState<boolean | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaError, setOllamaError]   = useState<string | null>(null);
  const [checking, setChecking]         = useState(false);

  useEffect(() => {
    fetch("/api/llm-settings")
      .then(async r => {
        const text = await r.text();
        if (!text) throw new Error("Empty response from settings API — try restarting the admin server.");
        return JSON.parse(text);
      })
      .then(data => {
        if (data.error) throw new Error(data.error);
        // Auto-correct mismatched provider/model pairs
        const isClaudeModel  = (m: string) => m?.startsWith("claude-");
        const isOpenAIModel  = (m: string) => m?.startsWith("gpt-") || m?.startsWith("o1") || m?.startsWith("o3");
        if (data.filter_provider === "ollama" && (isClaudeModel(data.filter_model) || isOpenAIModel(data.filter_model))) {
          data.filter_model = "";
        }
        if (data.summarise_provider === "ollama" && (isClaudeModel(data.summarise_model) || isOpenAIModel(data.summarise_model))) {
          data.summarise_model = "";
        }
        if (data.filter_provider === "openai" && isClaudeModel(data.filter_model)) {
          data.filter_model = "gpt-4o-mini";
        }
        if (data.summarise_provider === "openai" && isClaudeModel(data.summarise_model)) {
          data.summarise_model = "gpt-4o";
        }
        // Ensure new fields have defaults if not yet in DB
        if (!data.filter_threshold)          data.filter_threshold          = "5";
        if (data.filter_prompt_override   == null) data.filter_prompt_override   = "";
        if (data.summarise_style_override == null) data.summarise_style_override = "";
        setSettings(data);
      })
      .catch(err => setLoadError(err.message));
  }, []);

  const checkOllama = useCallback(async (baseUrl?: string) => {
    setChecking(true);
    setOllamaOk(null);
    setOllamaError(null);
    setOllamaModels([]);
    if (baseUrl && settings) {
      await fetch("/api/llm-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ollama_base_url: baseUrl }),
      });
    }
    const res = await fetch("/api/ollama-models");
    const data = await res.json();
    setChecking(false);
    if (res.ok) {
      setOllamaOk(true);
      setOllamaModels(data.models ?? []);
    } else {
      setOllamaOk(false);
      setOllamaError(data.error ?? "Unknown error");
    }
  }, [settings]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/llm-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      setSaving(false);
      if (res.ok) {
        setSettings(data);
        setSaveMsg("Settings saved.");
        setTimeout(() => setSaveMsg(null), 3000);
      } else {
        setSaveMsg(`Error: ${data.error ?? res.statusText ?? "Unknown error"}`);
      }
    } catch (err) {
      setSaving(false);
      setSaveMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function patch(key: keyof LLMSettings, value: string) {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev);
  }

  if (loadError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-5 max-w-xl">
        <p className="font-semibold text-red-700 mb-1">Could not load settings</p>
        <p className="text-sm text-red-600 mb-3">{loadError}</p>
        <p className="text-xs text-red-500">
          Restart the admin dev server (<code className="font-mono bg-red-100 px-1 rounded">npm run dev</code>) so the
          database migration that creates the <code className="font-mono bg-red-100 px-1 rounded">settings</code> table runs,
          then reload this page.
        </p>
      </div>
    );
  }

  if (!settings) {
    return <p className="text-amber-600 text-sm">Loading settings…</p>;
  }

  const threshold = parseInt(settings.filter_threshold) || 5;
  const filterHasOverride = settings.filter_prompt_override !== "";
  const summariseHasOverride = settings.summarise_style_override !== "";

  // What the filter instructions textarea shows
  const filterInstructionsPreview = filterHasOverride
    ? settings.filter_prompt_override
    : buildFilterInstructions(threshold);

  // What the summarise style textarea shows
  const summariseStylePreview = summariseHasOverride
    ? settings.summarise_style_override
    : DEFAULT_SUMMARISE_STYLE;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-amber-900 mb-1">LLM Settings</h1>
      <p className="text-amber-700 text-sm mb-8">
        Choose which AI provider and model to use for each task. Changes take effect immediately — no restart needed.
      </p>

      {/* ── Positivity filter ── */}
      <Section title="Positivity filter" subtitle="Runs on every fetched article headline. High volume — a fast/cheap model is ideal.">
        <ProviderRow
          provider={settings.filter_provider}
          model={settings.filter_model}
          ollamaModels={ollamaModels}
          onProviderChange={v => patch("filter_provider", v)}
          onModelChange={v => patch("filter_model", v)}
        />

        {/* Threshold slider */}
        <div className="mt-5 pt-4 border-t border-yellow-100">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-amber-700">Positivity strictness</label>
            {filterHasOverride && (
              <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-medium">
                custom override active — slider disabled
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-xs text-amber-500 w-16 shrink-0">Very lenient</span>
            <input
              type="range" min={1} max={10} step={1}
              value={threshold}
              disabled={filterHasOverride}
              onChange={e => patch("filter_threshold", e.target.value)}
              className="flex-1 accent-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <span className="text-xs text-amber-500 w-16 shrink-0 text-right">Very strict</span>
          </div>
          <p className="text-xs text-amber-600 mb-4">{THRESHOLD_LABELS[threshold]}</p>

          {/* Filter instructions textarea */}
          <label className="block text-xs font-medium text-amber-700 mb-1">
            Filter instructions
            {filterHasOverride
              ? " — custom (editing enabled)"
              : " — auto-generated from slider (read-only)"}
          </label>
          <textarea
            rows={6}
            readOnly={!filterHasOverride}
            value={filterInstructionsPreview}
            onChange={e => patch("filter_prompt_override", e.target.value)}
            className={`w-full border rounded-lg px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none resize-y transition-colors ${
              filterHasOverride
                ? "border-orange-300 bg-white focus:border-orange-400"
                : "border-yellow-200 bg-amber-50 text-amber-700 cursor-default"
            }`}
          />
          <div className="flex gap-2 mt-2">
            {!filterHasOverride ? (
              <button
                onClick={() => patch("filter_prompt_override", buildFilterInstructions(threshold))}
                className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                ✎ Customise instructions
              </button>
            ) : (
              <button
                onClick={() => patch("filter_prompt_override", "")}
                className="text-xs bg-orange-100 hover:bg-orange-200 text-orange-800 font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                ↩ Reset to auto (slider)
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* ── Summarisation ── */}
      <Section title="Summarisation & translation" subtitle="Runs once per article you manually review. Lower volume — quality matters more than speed.">
        <ProviderRow
          provider={settings.summarise_provider}
          model={settings.summarise_model}
          ollamaModels={ollamaModels}
          onProviderChange={v => patch("summarise_provider", v)}
          onModelChange={v => patch("summarise_model", v)}
        />

        {/* Summarise style textarea */}
        <div className="mt-5 pt-4 border-t border-yellow-100">
          <label className="block text-xs font-medium text-amber-700 mb-1">
            Voice &amp; style
            {summariseHasOverride
              ? " — custom (editing enabled)"
              : " — default (read-only)"}
          </label>
          <textarea
            rows={10}
            readOnly={!summariseHasOverride}
            value={summariseStylePreview}
            onChange={e => patch("summarise_style_override", e.target.value)}
            className={`w-full border rounded-lg px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none resize-y transition-colors ${
              summariseHasOverride
                ? "border-orange-300 bg-white focus:border-orange-400"
                : "border-yellow-200 bg-amber-50 text-amber-700 cursor-default"
            }`}
          />
          <div className="flex gap-2 mt-2">
            {!summariseHasOverride ? (
              <button
                onClick={() => patch("summarise_style_override", DEFAULT_SUMMARISE_STYLE)}
                className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                ✎ Customise style
              </button>
            ) : (
              <button
                onClick={() => patch("summarise_style_override", "")}
                className="text-xs bg-orange-100 hover:bg-orange-200 text-orange-800 font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                ↩ Reset to default
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* ── Ollama connection ── */}
      <Section title="Ollama connection" subtitle="Only needed if you are using Ollama for either task above.">
        <div className="flex gap-3 items-center mb-3 flex-wrap">
          <input
            className="border border-yellow-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[220px] focus:outline-none focus:border-yellow-400 font-mono"
            value={settings.ollama_base_url}
            onChange={e => patch("ollama_base_url", e.target.value)}
            placeholder="http://localhost:11434"
          />
          <button
            onClick={() => checkOllama(settings.ollama_base_url)}
            disabled={checking}
            className="text-sm bg-amber-100 hover:bg-amber-200 text-amber-800 font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {checking ? "Checking…" : "Test connection"}
          </button>
          <Badge ok={ollamaOk} />
        </div>
        {ollamaError && (
          <p className="text-xs text-red-500 mb-2">{ollamaError}</p>
        )}
        {ollamaModels.length > 0 && (
          <div className="bg-amber-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
              Pulled models ({ollamaModels.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {ollamaModels.map(m => (
                <span key={m} className="text-xs font-mono bg-white border border-yellow-200 text-amber-800 px-2 py-0.5 rounded">
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}
        {ollamaOk === false && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-2 text-xs text-red-700">
            <p className="font-semibold mb-1">Ollama is not running or not reachable.</p>
            <p>Start it with: <code className="font-mono bg-red-100 px-1 rounded">ollama serve</code></p>
            <p className="mt-1">Pull a model with: <code className="font-mono bg-red-100 px-1 rounded">ollama pull llama3.2:3b</code></p>
          </div>
        )}
      </Section>

      {/* ── Save button ── */}
      <div className="flex items-center gap-4 mt-2">
        <button
          onClick={save}
          disabled={saving}
          className="bg-amber-900 hover:bg-amber-800 text-yellow-300 font-medium px-6 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {saveMsg && <p className="text-sm text-amber-600">{saveMsg}</p>}
      </div>

      {/* ── Current config summary ── */}
      <div className="mt-10 bg-white border border-yellow-200 rounded-xl p-5">
        <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">Active configuration</p>
        <table className="w-full text-sm">
          <tbody>
            <ConfigRow
              label="Filter"
              provider={settings.filter_provider}
              model={settings.filter_model}
              extra={filterHasOverride ? "custom prompt" : `threshold ${threshold}`}
            />
            <ConfigRow
              label="Summarise"
              provider={settings.summarise_provider}
              model={settings.summarise_model}
              extra={summariseHasOverride ? "custom style" : "default style"}
            />
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <h2 className="text-base font-semibold text-amber-900 mb-0.5">{title}</h2>
      <p className="text-xs text-amber-600 mb-3">{subtitle}</p>
      <div className="bg-white border border-yellow-200 rounded-xl p-5">
        {children}
      </div>
    </div>
  );
}

function ProviderRow({ provider, model, ollamaModels, onProviderChange, onModelChange }: {
  provider: Provider;
  model: string;
  ollamaModels: string[];
  onProviderChange: (v: Provider) => void;
  onModelChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-3 flex-wrap items-start">
      {/* Provider picker */}
      <div className="flex-1 min-w-[160px]">
        <label className="block text-xs text-amber-600 mb-1 font-medium">Provider</label>
        <select
          className="w-full border border-yellow-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-yellow-400"
          value={provider}
          onChange={e => {
            const p = e.target.value as Provider;
            onProviderChange(p);
            if (p === "anthropic") onModelChange("claude-haiku-4-5-20251001");
            else if (p === "openai") onModelChange("gpt-4o-mini");
            else if (ollamaModels.length > 0) onModelChange(ollamaModels[0]);
            else onModelChange("");
          }}
        >
          {(Object.keys(PROVIDER_LABELS) as Provider[]).map(p => (
            <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
          ))}
        </select>
      </div>

      {/* Model picker */}
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs text-amber-600 mb-1 font-medium">Model</label>
        {provider === "anthropic" ? (
          <select
            className="w-full border border-yellow-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-yellow-400"
            value={model}
            onChange={e => onModelChange(e.target.value)}
          >
            {ANTHROPIC_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        ) : provider === "openai" ? (
          <select
            className="w-full border border-yellow-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-yellow-400"
            value={model}
            onChange={e => onModelChange(e.target.value)}
          >
            {OPENAI_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        ) : ollamaModels.length > 0 ? (
          <select
            className="w-full border border-yellow-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-yellow-400"
            value={model}
            onChange={e => onModelChange(e.target.value)}
          >
            {ollamaModels.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <input
            className="w-full border border-yellow-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-yellow-400"
            placeholder="e.g. llama3.2:3b"
            value={model}
            onChange={e => onModelChange(e.target.value)}
          />
        )}
        {provider === "ollama" && ollamaModels.length === 0 && (
          <p className="text-xs text-amber-500 mt-1">Test the Ollama connection below to populate the model list.</p>
        )}
      </div>
    </div>
  );
}

function ConfigRow({ label, provider, model, extra }: {
  label: string; provider: string; model: string; extra?: string;
}) {
  return (
    <tr className="border-b border-yellow-50 last:border-0">
      <td className="py-1.5 pr-4 text-amber-600 font-medium w-24">{label}</td>
      <td className="py-1.5 pr-4">
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
          provider === "ollama"
            ? "bg-green-100 text-green-700"
            : provider === "openai"
              ? "bg-purple-100 text-purple-700"
              : "bg-blue-100 text-blue-700"
        }`}>
          {provider === "ollama" ? "Ollama (local)" : provider === "openai" ? "OpenAI" : "Anthropic"}
        </span>
      </td>
      <td className="py-1.5 pr-4 font-mono text-xs text-amber-800">{model}</td>
      {extra && <td className="py-1.5 text-xs text-amber-500 italic">{extra}</td>}
    </tr>
  );
}
