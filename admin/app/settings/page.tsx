"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
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
  positronitron_enabled: string;
  positronitron_count: string;
  positronitron_run_times: string;
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

const PLATFORM_META: Record<string, { label: string; emoji: string; color: string }> = {
  bluesky:   { label: "Bluesky",   emoji: "🦋", color: "bg-sky-100 text-sky-700" },
  x:         { label: "X",         emoji: "✖",  color: "bg-gray-100 text-gray-700" },
  threads:   { label: "Threads",   emoji: "🧵", color: "bg-gray-100 text-gray-800" },
  facebook:  { label: "Facebook",  emoji: "👤", color: "bg-blue-100 text-blue-700" },
  instagram: { label: "Instagram", emoji: "📸", color: "bg-pink-100 text-pink-700" },
  tiktok:    { label: "TikTok",    emoji: "🎵", color: "bg-gray-100 text-gray-800" },
  youtube:   { label: "YouTube",   emoji: "▶️", color: "bg-red-100 text-red-700" },
  linkedin:  { label: "LinkedIn",  emoji: "💼", color: "bg-blue-100 text-blue-800" },
};

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
  const router = useRouter();
  const [settings, setSettings]         = useState<LLMSettings | null>(null);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [saveMsg, setSaveMsg]           = useState<string | null>(null);
  const [ollamaOk, setOllamaOk]         = useState<boolean | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaError, setOllamaError]   = useState<string | null>(null);
  const [checking, setChecking]         = useState(false);

  // Social accounts state
  type SocialAccount = { id: string; platform: string; username: string; profile_photo_url: string | null; status: string };
  const [socialAccounts,  setSocialAccounts]  = useState<SocialAccount[]>([]);
  const [enabledIds,      setEnabledIds]      = useState<Set<string>>(new Set());
  const [socialLoading,   setSocialLoading]   = useState(true);
  const [socialSaving,    setSocialSaving]    = useState(false);
  const [socialSaveMsg,   setSocialSaveMsg]   = useState<string | null>(null);

  // Backup / restore state
  const [backingUp,    setBackingUp]    = useState(false);
  const [restoring,    setRestoring]    = useState(false);
  const [restoreMsg,   setRestoreMsg]   = useState<string | null>(null);
  const [restoreOk,    setRestoreOk]    = useState<boolean | null>(null);
  const restoreInput                    = useRef<HTMLInputElement>(null);

  // Positronitron run state
  const [ptronRunning,  setPtronRunning]  = useState(false);
  const [ptronResult,   setPtronResult]   = useState<string | null>(null);
  const [runTimes,      setRunTimes]      = useState<string[]>(["08:00", "15:00"]);

  // Auth state
  const [loggingOut,   setLoggingOut]   = useState(false);

  useEffect(() => {
    // Load social accounts and enabled IDs in parallel
    Promise.all([
      fetch("/api/social-accounts").then(r => r.json()),
      fetch("/api/social-accounts/enabled").then(r => r.json()),
    ]).then(([accountsData, enabledData]) => {
      setSocialAccounts(accountsData.accounts ?? []);
      setEnabledIds(new Set(enabledData.enabled ?? []));
    }).catch(console.error).finally(() => setSocialLoading(false));
  }, []);

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
        if (!data.positronitron_enabled)   data.positronitron_enabled   = "false";
        if (!data.positronitron_count)     data.positronitron_count     = "3";
        if (!data.positronitron_run_times) data.positronitron_run_times = '["08:00","15:00"]';
        try { setRunTimes(JSON.parse(data.positronitron_run_times)); } catch {}
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

  function toggleSocialAccount(id: string) {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function saveSocialAccounts() {
    setSocialSaving(true);
    setSocialSaveMsg(null);
    try {
      const res = await fetch("/api/social-accounts/enabled", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ enabled: [...enabledIds] }),
      });
      if (res.ok) {
        setSocialSaveMsg("Saved.");
        setTimeout(() => setSocialSaveMsg(null), 3000);
      } else {
        setSocialSaveMsg("Save failed.");
      }
    } finally {
      setSocialSaving(false);
    }
  }

  async function downloadBackup() {
    setBackingUp(true);
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) throw new Error(`Backup failed: ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `positron-backup-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setBackingUp(false);
    }
  }

  async function restoreBackup(file: File) {
    if (!confirm(`⚠ This will REPLACE all current data with the contents of "${file.name}". Continue?`)) return;
    setRestoring(true);
    setRestoreMsg(null);
    setRestoreOk(null);
    try {
      const text   = await file.text();
      const backup = JSON.parse(text);
      const res    = await fetch("/api/restore", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(backup),
      });
      const data = await res.json();
      if (res.ok) {
        const s = data.stats as Record<string, number>;
        setRestoreOk(true);
        setRestoreMsg(
          `Restored successfully from ${data.restored_from?.slice(0, 10) ?? "backup"}: ` +
          Object.entries(s).map(([k, v]) => `${v} ${k}`).join(", ") + "."
        );
      } else {
        setRestoreOk(false);
        setRestoreMsg(data.error ?? "Restore failed.");
      }
    } catch (err) {
      setRestoreOk(false);
      setRestoreMsg(err instanceof Error ? err.message : "Restore failed.");
    } finally {
      setRestoring(false);
      if (restoreInput.current) restoreInput.current.value = "";
    }
  }

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      // Sync run times into settings before saving
      const toSave = { ...settings, positronitron_run_times: JSON.stringify(runTimes) };
      const res = await fetch("/api/llm-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSave),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      setSaving(false);
      if (res.ok) {
        setSettings(data);
        setSaveMsg("Settings saved.");
        // Regenerate launchd schedule from saved run times
        try { await fetch("/api/positronitron-schedule", { method: "POST" }); } catch {}
        // Refresh layout so the ⚡ AUTO banner updates immediately
        router.refresh();
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
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-yellow-100">
            <button onClick={save} disabled={saving} className="bg-amber-900 hover:bg-amber-800 text-yellow-300 font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
            {saveMsg && <p className="text-sm text-amber-600">{saveMsg}</p>}
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
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-yellow-100">
            <button onClick={save} disabled={saving} className="bg-amber-900 hover:bg-amber-800 text-yellow-300 font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
            {saveMsg && <p className="text-sm text-amber-600">{saveMsg}</p>}
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
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-yellow-100">
          <button onClick={save} disabled={saving} className="bg-amber-900 hover:bg-amber-800 text-yellow-300 font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
          {saveMsg && <p className="text-sm text-amber-600">{saveMsg}</p>}
        </div>
      </Section>

      {/* ── Analytics ── */}
      <div className="mt-6 bg-white border border-yellow-200 rounded-xl p-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-0.5">Analytics</p>
          <p className="text-xs text-amber-600">Umami — privacy-friendly, no cookies</p>
        </div>
        <a
          href="https://cloud.umami.is/analytics/eu/websites"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm bg-amber-100 hover:bg-amber-200 text-amber-800 font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
        >
          Open Umami dashboard ↗
        </a>
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

      {/* ── Positronitron ── */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-amber-900 mb-0.5">⚡ Positronitron</h2>
        <p className="text-xs text-amber-600 mb-3">
          Autonomous publishing mode. When enabled, a scheduled job fetches RSS feeds twice daily,
          selects the most positive articles, summarises them, and schedules them for publishing with social announcements.
        </p>
        <div className={`border rounded-xl p-5 transition-colors ${settings?.positronitron_enabled === "true" ? "bg-green-50 border-green-300" : "bg-white border-yellow-200"}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSettings((s) => s ? { ...s, positronitron_enabled: s.positronitron_enabled === "true" ? "false" : "true" } : s)}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${settings?.positronitron_enabled === "true" ? "bg-green-500" : "bg-gray-300"}`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${settings?.positronitron_enabled === "true" ? "translate-x-6" : "translate-x-1"}`} />
              </button>
              <span className={`text-sm font-semibold ${settings?.positronitron_enabled === "true" ? "text-green-700" : "text-gray-500"}`}>
                {settings?.positronitron_enabled === "true" ? "Active — running autonomously" : "Off — manual mode"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-amber-700 font-medium whitespace-nowrap">Articles per batch:</label>
            <input
              type="number"
              min={1}
              max={10}
              value={settings?.positronitron_count ?? "3"}
              onChange={(e) => setSettings((s) => s ? { ...s, positronitron_count: e.target.value } : s)}
              className="border border-yellow-200 rounded px-2 py-1 text-sm w-16 text-amber-800 focus:outline-none focus:border-yellow-400"
            />
            <span className="text-xs text-amber-500">most positive articles selected per run</span>
          </div>
          <div className="mt-4">
            <label className="text-xs text-amber-700 font-medium">Run schedule:</label>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {runTimes.map((time, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => {
                      const updated = [...runTimes];
                      updated[i] = e.target.value;
                      setRunTimes(updated);
                    }}
                    className="border border-yellow-200 rounded px-2 py-1 text-sm text-amber-800 focus:outline-none focus:border-yellow-400"
                  />
                  {runTimes.length > 1 && (
                    <button
                      onClick={() => setRunTimes(runTimes.filter((_, j) => j !== i))}
                      className="text-red-400 hover:text-red-600 text-sm px-1"
                      title="Remove this time"
                    >✕</button>
                  )}
                </div>
              ))}
              {runTimes.length < 4 && (
                <button
                  onClick={() => setRunTimes([...runTimes, "12:00"])}
                  className="text-xs text-amber-600 hover:text-amber-800 border border-dashed border-yellow-300 rounded px-2 py-1"
                >+ Add time</button>
              )}
            </div>
            <p className="text-[11px] text-amber-400 mt-1">1–4 daily run times. Changes take effect after saving.</p>
          </div>
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-yellow-100">
            <button
              onClick={save}
              disabled={saving}
              className="bg-amber-900 hover:bg-amber-800 text-yellow-300 font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={async () => {
                setPtronRunning(true);
                setPtronResult(null);
                try {
                  const res = await fetch("/api/positronitron?manual=1", { method: "POST" });
                  const data = await res.json();
                  setPtronResult(res.ok ? `Done — ${data.scheduled ?? 0} article(s) scheduled.` : `Error: ${data.error ?? res.statusText}`);
                } catch (err) {
                  setPtronResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
                } finally {
                  setPtronRunning(false);
                }
              }}
              disabled={ptronRunning}
              className="bg-green-600 hover:bg-green-700 text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {ptronRunning ? "Running…" : "▶ Run now"}
            </button>
            {saveMsg && <p className="text-sm text-amber-600">{saveMsg}</p>}
            {ptronResult && <p className="text-sm text-amber-600">{ptronResult}</p>}
          </div>
          <p className="text-[11px] text-amber-400 mt-3">
            Schedule: {runTimes.join(", ")} daily via launchd. The hourly publish job handles the actual publishing.
          </p>
        </div>
      </div>

      {/* ── Social publishing ── */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-amber-900 mb-0.5">Social publishing</h2>
        <p className="text-xs text-amber-600 mb-3">
          Choose which connected accounts the 📣 button posts to. Connect new accounts in the{" "}
          <a href="https://app.postforme.dev" target="_blank" rel="noopener noreferrer"
            className="underline hover:text-amber-800">Post for Me dashboard ↗</a>.
        </p>
        <div className="bg-white border border-yellow-200 rounded-xl p-5">
          {socialLoading ? (
            <p className="text-sm text-amber-500">Loading accounts…</p>
          ) : socialAccounts.length === 0 ? (
            <p className="text-sm text-amber-500">
              No accounts found. Connect them in the{" "}
              <a href="https://app.postforme.dev" target="_blank" rel="noopener noreferrer"
                className="underline">Post for Me dashboard</a>.
            </p>
          ) : (
            <div className="space-y-2">
              {socialAccounts.map((acct) => {
                const meta = PLATFORM_META[acct.platform] ?? { label: acct.platform, emoji: "🌐", color: "bg-gray-100 text-gray-700" };
                const enabled = enabledIds.has(acct.id);
                return (
                  <label key={acct.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      enabled ? "border-yellow-300 bg-yellow-50" : "border-yellow-100 hover:bg-amber-50/50"
                    }`}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggleSocialAccount(acct.id)}
                      className="accent-amber-600 w-4 h-4 shrink-0"
                    />
                    {acct.profile_photo_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={acct.profile_photo_url} alt="" className="w-8 h-8 rounded-full shrink-0 object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-base shrink-0">
                        {meta.emoji}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.color}`}>
                          {meta.emoji} {meta.label}
                        </span>
                        {acct.status !== "connected" && (
                          <span className="text-xs text-red-500">● {acct.status}</span>
                        )}
                        {acct.platform === "instagram" && enabled && (
                          <span className="text-xs text-pink-500 italic">uses generated card image</span>
                        )}
                      </div>
                      <p className="text-xs text-amber-600 mt-0.5 truncate">@{acct.username}</p>
                    </div>
                  </label>
                );
              })}
              <div className="flex items-center gap-4 pt-2">
                <button
                  onClick={saveSocialAccounts}
                  disabled={socialSaving}
                  className="bg-amber-900 hover:bg-amber-800 text-yellow-300 font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {socialSaving ? "Saving…" : "Save"}
                </button>
                {socialSaveMsg && <p className="text-sm text-amber-600">{socialSaveMsg}</p>}
                <p className="text-xs text-amber-400 ml-auto">
                  {enabledIds.size} of {socialAccounts.length} enabled
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Data & Migration ── */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-amber-900 mb-0.5">Data &amp; migration</h2>
        <p className="text-xs text-amber-600 mb-3">
          Download a full backup of your database or restore from a previous backup.
          Use this to migrate between local and cloud environments.
        </p>
        <div className="bg-white border border-yellow-200 rounded-xl p-5 space-y-5">

          {/* Backup */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium text-amber-900">Download backup</p>
              <p className="text-xs text-amber-500 mt-0.5">
                Exports sources, topics, articles, tags, rejections, and settings as a JSON file.
              </p>
            </div>
            <button
              onClick={downloadBackup}
              disabled={backingUp}
              className="text-sm bg-amber-100 hover:bg-amber-200 text-amber-800 font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {backingUp ? "Preparing…" : "⬇ Download backup"}
            </button>
          </div>

          <hr className="border-yellow-100" />

          {/* Restore */}
          <div>
            <p className="text-sm font-medium text-amber-900 mb-0.5">Restore from backup</p>
            <p className="text-xs text-amber-500 mb-3">
              ⚠ Replaces <strong>all</strong> current data. Choose a <code className="font-mono bg-amber-50 px-1 rounded">.json</code> backup file exported from this admin.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                ref={restoreInput}
                type="file"
                accept=".json,application/json"
                disabled={restoring}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) restoreBackup(file);
                }}
                className="text-sm text-amber-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-yellow-200 file:text-xs file:font-medium file:text-amber-800 file:bg-amber-50 hover:file:bg-amber-100 file:cursor-pointer disabled:opacity-50"
              />
              {restoring && <span className="text-xs text-amber-500">Restoring…</span>}
            </div>
            {restoreMsg && (
              <div className={`mt-3 text-xs rounded-lg px-3 py-2 border ${
                restoreOk
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}>
                {restoreMsg}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Account ── */}
      <div className="mt-8 bg-white border border-yellow-200 rounded-xl p-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-0.5">Session</p>
          <p className="text-xs text-amber-500">Sign out of the admin panel</p>
        </div>
        <button
          onClick={logout}
          disabled={loggingOut}
          className="text-sm bg-red-50 hover:bg-red-100 text-red-600 font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {loggingOut ? "Signing out…" : "Sign out"}
        </button>
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
