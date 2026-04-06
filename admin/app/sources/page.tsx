"use client";

import { useEffect, useState } from "react";

type Source = {
  id: number;
  name: string;
  url: string;
  feed_url: string | null;
  type: "rss" | "website";
  language: string;
  active: number;
};

type EditState = { name: string; url: string; feed_url: string; language: string };

// SourceRow must live outside SourcesPage so React doesn't treat it as a new
// component type on every render (which would unmount/remount and scroll to top).
function SourceRow({
  source, isEditing, editState,
  onEdit, onSave, onCancel, onToggle, onRemove, onEditStateChange,
}: {
  source: Source;
  isEditing: boolean;
  editState: EditState;
  onEdit: (s: Source) => void;
  onSave: (id: number) => void;
  onCancel: () => void;
  onToggle: (s: Source) => void;
  onRemove: (id: number) => void;
  onEditStateChange: (s: EditState) => void;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-yellow-200 overflow-hidden">
      {isEditing ? (
        <div className="px-5 py-4 flex flex-col gap-2">
          <div className="grid md:grid-cols-2 gap-2">
            <input className="border border-yellow-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-yellow-500"
              value={editState.name} onChange={e => onEditStateChange({ ...editState, name: e.target.value })}
              placeholder="Name" />
            <input className="border border-yellow-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-yellow-500"
              value={editState.url} onChange={e => onEditStateChange({ ...editState, url: e.target.value })}
              placeholder="Website URL" />
          </div>
          <input className="border border-yellow-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-yellow-500"
            value={editState.feed_url} onChange={e => onEditStateChange({ ...editState, feed_url: e.target.value })}
            placeholder="RSS feed URL (leave blank if none)" />
          <div className="flex gap-2 items-center flex-wrap">
            <select className="border border-yellow-300 rounded-lg px-3 py-1.5 text-sm"
              value={editState.language} onChange={e => onEditStateChange({ ...editState, language: e.target.value })}>
              <option value="nl">Dutch (NL)</option>
              <option value="fr">French (FR)</option>
              <option value="en">English (EN)</option>
            </select>
            <button type="button" onClick={() => onSave(source.id)}
              className="bg-green-400 hover:bg-green-500 text-green-900 font-medium px-4 py-1.5 rounded-lg text-sm transition-colors">
              Save
            </button>
            <button type="button" onClick={onCancel}
              className="text-sm text-amber-600 hover:text-amber-800 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-lg mt-0.5">{source.feed_url || source.type === "rss" ? "📡" : "🌐"}</span>
            <div className="min-w-0">
              <p className="font-medium text-amber-900 text-sm">{source.name}</p>
              <a href={source.url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-amber-400 hover:text-amber-600 truncate block transition-colors">
                {source.url}
              </a>
              {source.feed_url && (
                <a href={source.feed_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-600 truncate block transition-colors">
                  📡 {source.feed_url}
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase">
              {source.language}
            </span>
            <button type="button" onClick={() => onToggle(source)}
              className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                source.active ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}>
              {source.active ? "Active" : "Inactive"}
            </button>
            <button type="button" onClick={() => onEdit(source)}
              className="text-xs text-amber-600 hover:text-amber-900 transition-colors font-medium">
              Edit
            </button>
            <button type="button" onClick={() => onRemove(source.id)}
              className="text-xs text-red-400 hover:text-red-600 transition-colors">
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [form, setForm] = useState({ name: "", url: "", feed_url: "", type: "website", language: "en" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState>({ name: "", url: "", feed_url: "", language: "en" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [exportStatus, setExportStatus] = useState<"idle"|"exporting"|"ok"|"error">("idle");

  async function load() {
    const res = await fetch("/api/sources");
    setSources(await res.json());
  }
  useEffect(() => { load(); }, []);

  async function publishToSite() {
    setExportStatus("exporting");
    try {
      const res = await fetch("/api/export-sources", { method: "POST" });
      setExportStatus(res.ok ? "ok" : "error");
    } catch {
      setExportStatus("error");
    }
    setTimeout(() => setExportStatus("idle"), 4000);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) { setError((await res.json()).error ?? "Error"); return; }
    setForm({ name: "", url: "", feed_url: "", type: "website", language: "en" });
    load();
  }

  function startEdit(source: Source) {
    setEditingId(source.id);
    setEditState({ name: source.name, url: source.url, feed_url: source.feed_url ?? "", language: source.language });
  }

  async function saveEdit(id: number) {
    await fetch("/api/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editState }),
    });
    setEditingId(null);
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

  const withFeed = sources.filter(s => s.feed_url || s.type === "rss");
  const webOnly  = sources.filter(s => !s.feed_url && s.type !== "rss");

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-bold text-amber-900">Sources</h1>
        <button
          onClick={publishToSite}
          disabled={exportStatus === "exporting"}
          className="shrink-0 bg-amber-400 hover:bg-amber-500 text-amber-900 font-medium px-4 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {exportStatus === "exporting" ? "Publishing…" :
           exportStatus === "ok"        ? "✓ Published!" :
           exportStatus === "error"     ? "✗ Error" :
                                          "Publish to site"}
        </button>
      </div>
      <p className="text-amber-700 text-sm mb-8">
        Sources with an RSS feed URL are fetched automatically. Website-only sources can be browsed manually via the Preview tab.
        Changes are published to the About page automatically; use the button to force a manual sync.
      </p>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-yellow-200 mb-8">
        <h2 className="font-semibold text-amber-900 mb-4">Add a source</h2>
        <form onSubmit={add} className="flex flex-col gap-3">
          <div className="grid md:grid-cols-2 gap-3">
            <input className="border border-yellow-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
              placeholder="Name (e.g. Good News Network)" value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })} required />
            <input className="border border-yellow-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
              placeholder="Website URL" value={form.url}
              onChange={e => setForm({ ...form, url: e.target.value })} required />
          </div>
          <input className="border border-yellow-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
            placeholder="RSS feed URL (optional — enables auto-fetch)" value={form.feed_url}
            onChange={e => setForm({ ...form, feed_url: e.target.value })} />
          <div className="flex gap-3 flex-wrap items-center">
            <select className="border border-yellow-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
              value={form.language} onChange={e => setForm({ ...form, language: e.target.value })}>
              <option value="nl">Dutch (NL)</option>
              <option value="fr">French (FR)</option>
              <option value="en">English (EN)</option>
            </select>
            <button type="submit" disabled={loading}
              className="bg-yellow-400 hover:bg-yellow-500 text-amber-900 font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
              {loading ? "Adding..." : "Add source"}
            </button>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </form>
      </div>

      {withFeed.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">
            Auto-fetched via RSS ({withFeed.length})
          </h2>
          <div className="flex flex-col gap-2">{withFeed.map(s => (
            <SourceRow key={s.id} source={s}
              isEditing={editingId === s.id} editState={editState}
              onEdit={startEdit} onSave={saveEdit} onCancel={() => setEditingId(null)}
              onToggle={toggle} onRemove={remove} onEditStateChange={setEditState} />
          ))}</div>
        </div>
      )}

      {webOnly.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">
            Website only — add articles manually ({webOnly.length})
          </h2>
          <div className="flex flex-col gap-2">{webOnly.map(s => (
            <SourceRow key={s.id} source={s}
              isEditing={editingId === s.id} editState={editState}
              onEdit={startEdit} onSave={saveEdit} onCancel={() => setEditingId(null)}
              onToggle={toggle} onRemove={remove} onEditStateChange={setEditState} />
          ))}</div>
        </div>
      )}

      {sources.length === 0 && <p className="text-amber-600 text-sm">No sources yet.</p>}
    </div>
  );
}
