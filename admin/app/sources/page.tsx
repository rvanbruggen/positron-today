"use client";

import { useEffect, useRef, useState } from "react";

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
        <div className="px-5 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
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
          <div className="flex items-center gap-2 sm:shrink-0 flex-wrap">
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

  type OpmlDuplicate = { name: string; url: string; feed_url: string | null; existingName: string; matchedOn: "url" | "feed_url" };
  type OpmlInvalid   = { name: string; reason: string };
  type OpmlImportResult = {
    importedCount: number;
    skippedDuplicateCount: number;
    skippedInvalidCount: number;
    skippedDuplicates: OpmlDuplicate[];
    skippedInvalid: OpmlInvalid[];
  };
  const [importing,     setImporting]     = useState(false);
  const [importResult,  setImportResult]  = useState<OpmlImportResult | null>(null);
  const [importError,   setImportError]   = useState<string | null>(null);
  const opmlFileInput                     = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch("/api/sources");
    setSources(await res.json());
  }
  useEffect(() => { load(); }, []);

  function downloadOpml() {
    // Use a link click so the browser honours Content-Disposition.
    const a = document.createElement("a");
    a.href = "/api/sources/opml";
    a.click();
  }

  async function importOpml(file: File) {
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/sources/opml", {
        method:  "POST",
        headers: { "Content-Type": "text/xml" },
        body:    text,
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? `Import failed (${res.status})`);
      } else {
        setImportResult(data as OpmlImportResult);
        load();
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      if (opmlFileInput.current) opmlFileInput.current.value = "";
    }
  }

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
    if (!confirm("Remove this source? Any pending (unfetched) articles from this source will also be deleted.")) return;
    const res = await fetch(`/api/sources?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to delete source");
      return;
    }
    load();
  }

  const withFeed = sources.filter(s => s.feed_url || s.type === "rss");
  const webOnly  = sources.filter(s => !s.feed_url && s.type !== "rss");

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-bold text-amber-900">Sources</h1>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <button
            onClick={downloadOpml}
            className="bg-white hover:bg-yellow-50 text-amber-900 border border-yellow-300 font-medium px-3 py-1.5 rounded-lg text-sm transition-colors"
            title="Download all sources as an OPML 2.0 file"
          >
            📤 Export OPML
          </button>
          <button
            onClick={() => opmlFileInput.current?.click()}
            disabled={importing}
            className="bg-white hover:bg-yellow-50 text-amber-900 border border-yellow-300 font-medium px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            title="Import sources from an OPML file (duplicates are skipped)"
          >
            {importing ? "Importing…" : "📥 Import OPML"}
          </button>
          <input
            ref={opmlFileInput}
            type="file"
            accept=".opml,.xml,text/xml,application/xml,text/x-opml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importOpml(file);
            }}
          />
          <button
            onClick={publishToSite}
            disabled={exportStatus === "exporting"}
            className="bg-amber-400 hover:bg-amber-500 text-amber-900 font-medium px-4 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {exportStatus === "exporting" ? "Publishing…" :
             exportStatus === "ok"        ? "✓ Published!" :
             exportStatus === "error"     ? "✗ Error" :
                                            "Publish to site"}
          </button>
        </div>
      </div>
      <p className="text-amber-700 text-sm mb-4">
        Sources with an RSS feed URL are fetched automatically. Website-only sources can be browsed manually via the Preview tab.
        Changes are published to the About page automatically; use the button to force a manual sync.
      </p>

      {importError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-red-700">OPML import failed</p>
          <p className="text-sm text-red-600 mt-1">{importError}</p>
          <button
            onClick={() => setImportError(null)}
            className="text-xs text-red-500 hover:text-red-700 mt-2"
          >Dismiss</button>
        </div>
      )}

      {importResult && (
        <div className="mb-6 bg-white border border-yellow-200 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                OPML import complete · {importResult.importedCount} added
                {importResult.skippedDuplicateCount > 0 && (
                  <span className="text-amber-700 font-medium"> · {importResult.skippedDuplicateCount} skipped (duplicate)</span>
                )}
                {importResult.skippedInvalidCount > 0 && (
                  <span className="text-red-500 font-medium"> · {importResult.skippedInvalidCount} invalid</span>
                )}
              </p>
              {importResult.skippedDuplicateCount > 0 && (
                <p className="text-xs text-amber-700 mt-1">
                  ⚠ These feeds were already in your sources list. Please verify the existing entries are still correct —
                  a duplicate in the OPML file might signal an updated URL or a renamed feed.
                </p>
              )}
            </div>
            <button
              onClick={() => setImportResult(null)}
              className="text-xs text-amber-500 hover:text-amber-700 shrink-0"
            >Dismiss</button>
          </div>
          {importResult.skippedDuplicates.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-1.5">Skipped duplicates</p>
              <ul className="text-xs text-amber-700 space-y-1">
                {importResult.skippedDuplicates.map((d, i) => (
                  <li key={i} className="flex flex-col sm:flex-row sm:gap-2 sm:items-baseline">
                    <span className="font-medium text-amber-900">{d.name}</span>
                    <span className="text-amber-500 truncate">{d.feed_url ?? d.url}</span>
                    <span className="text-amber-400 text-[11px]">
                      matched existing &quot;{d.existingName}&quot; on {d.matchedOn === "feed_url" ? "feed URL" : "website URL"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {importResult.skippedInvalid.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1.5">Skipped (invalid)</p>
              <ul className="text-xs text-red-600 space-y-1">
                {importResult.skippedInvalid.map((d, i) => (
                  <li key={i}>
                    <span className="font-medium">{d.name || "(no name)"}</span>
                    <span className="text-red-400"> — {d.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

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
