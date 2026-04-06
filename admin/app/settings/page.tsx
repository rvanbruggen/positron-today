"use client";

import { useEffect, useState, useCallback } from "react";

type Provider = "anthropic" | "ollama";

interface LLMSettings {
  filter_provider: Provider;
  filter_model: string;
  summarise_provider: Provider;
  summarise_model: string;
  ollama_base_url: string;
}

const ANTHROPIC_MODELS = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fast & cheap" },
  { value: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6 — balanced" },
  { value: "claude-opus-4-5",           label: "Claude Opus 4.5 — best quality" },
];

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic (cloud)",
  ollama:    "Ollama (local)",
};

function Badge({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-xs text-amber-400">checking…</span>;
  return ok
    ? <span className="text-xs text-green-600 font-medium">● reachable</span>
    : <span className="text-xs text-red-500 font-medium">● unreachable</span>;
}

export default function SettingsPage() {
  const [settings, setSettings]       = useState<LLMSettings | null>(null);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState<string | null>(null);
  const [ollamaOk, setOllamaOk]       = useState<boolean | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [checking, setChecking]       = useState(false);

  useEffect(() => {
    fetch("/api/llm-settings")
      .then(async r => {
        const text = await r.text();
        if (!text) throw new Error("Empty response from settings API — try restarting the admin server.");
        return JSON.parse(text);
      })
      .then(data => {
        if (data.error) throw new Error(data.error);
        setSettings(data);
      })
      .catch(err => setLoadError(err.message));
  }, []);

  const checkOllama = useCallback(async (baseUrl?: string) => {
    setChecking(true);
    setOllamaOk(null);
    setOllamaError(null);
    setOllamaModels([]);
    // If a new base_url was just saved, the server will use that; otherwise current setting is used
    if (baseUrl && settings) {
      // Save the URL first so the server-side check uses the new value
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
            <ConfigRow label="Filter" provider={settings.filter_provider} model={settings.filter_model} />
            <ConfigRow label="Summarise" provider={settings.summarise_provider} model={settings.summarise_model} />
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
            // Reset model to a sensible default for the new provider
            if (p === "anthropic") onModelChange("claude-haiku-4-5-20251001");
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

function ConfigRow({ label, provider, model }: { label: string; provider: string; model: string }) {
  return (
    <tr className="border-b border-yellow-50 last:border-0">
      <td className="py-1.5 pr-4 text-amber-600 font-medium w-24">{label}</td>
      <td className="py-1.5 pr-4">
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
          provider === "ollama"
            ? "bg-green-100 text-green-700"
            : "bg-blue-100 text-blue-700"
        }`}>
          {provider === "ollama" ? "Ollama (local)" : "Anthropic"}
        </span>
      </td>
      <td className="py-1.5 font-mono text-xs text-amber-800">{model}</td>
    </tr>
  );
}
