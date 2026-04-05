"use client";

import { useEffect, useState } from "react";

type Source = {
  id: number;
  name: string;
  url: string;
  type: "rss" | "website";
  language: string;
  active: number;
  created_at: string;
};

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [form, setForm] = useState({ name: "", url: "", type: "rss", language: "en" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/sources");
    setSources(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Something went wrong");
      return;
    }
    setForm({ name: "", url: "", type: "rss", language: "en" });
    load();
  }

  async function toggle(source: Source) {
    await fetch("/api/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, active: !source.active }),
    });
    load();
  }

  async function remove(id: number) {
    if (!confirm("Remove this source?")) return;
    await fetch(`/api/sources?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-amber-900 mb-1">Sources</h1>
      <p className="text-amber-700 text-sm mb-8">
        RSS feeds and websites to scan for positive articles.
      </p>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-yellow-200 mb-8">
        <h2 className="font-semibold text-amber-900 mb-4">Add a source</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid md:grid-cols-2 gap-3">
            <input
              className="border border-yellow-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
              placeholder="Name (e.g. De Standaard)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <input
              className="border border-yellow-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
              placeholder="URL"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              required
            />
          </div>
          <div className="flex gap-3">
            <select
              className="border border-yellow-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="rss">RSS feed</option>
              <option value="website">Website</option>
            </select>
            <select
              className="border border-yellow-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
              value={form.language}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
            >
              <option value="nl">Dutch (nl)</option>
              <option value="fr">French (fr)</option>
              <option value="en">English (en)</option>
            </select>
            <button
              type="submit"
              disabled={loading}
              className="bg-yellow-400 hover:bg-yellow-500 text-amber-900 font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {loading ? "Adding..." : "Add source"}
            </button>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </form>
      </div>

      <div className="flex flex-col gap-3">
        {sources.length === 0 && (
          <p className="text-amber-600 text-sm">No sources yet. Add one above.</p>
        )}
        {sources.map((source) => (
          <div
            key={source.id}
            className="bg-white rounded-xl px-5 py-4 shadow-sm border border-yellow-200 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-lg">{source.type === "rss" ? "📡" : "🌐"}</span>
              <div className="min-w-0">
                <p className="font-medium text-amber-900 text-sm">{source.name}</p>
                <p className="text-xs text-amber-500 truncate">{source.url}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase">
                {source.language}
              </span>
              <button
                onClick={() => toggle(source)}
                className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                  source.active
                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {source.active ? "Active" : "Inactive"}
              </button>
              <button
                onClick={() => remove(source.id)}
                className="text-xs text-red-400 hover:text-red-600 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
