"use client";

import { useEffect, useState, useRef } from "react";

type Editorial = {
  id: number;
  slug: string;
  status: "draft" | "ready" | "published";
  source_language: string;
  title_en: string | null;
  title_nl: string | null;
  title_fr: string | null;
  summary_en: string | null;
  summary_nl: string | null;
  summary_fr: string | null;
  content_en: string | null;
  content_nl: string | null;
  content_fr: string | null;
  article_emoji: string | null;
  image_filename: string | null;
  post_to_substack: number;
  substack_posted_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  draft:     { bg: "bg-gray-200", text: "text-gray-700", label: "Draft" },
  ready:     { bg: "bg-green-200", text: "text-green-800", label: "Ready" },
  published: { bg: "bg-amber-200", text: "text-amber-800", label: "Published" },
};

const LANG_OPTIONS = [
  { value: "en", label: "🇬🇧 English" },
  { value: "nl", label: "🇳🇱 Nederlands" },
  { value: "fr", label: "🇫🇷 Français" },
];

export default function EditorialsPage() {
  const [editorials, setEditorials] = useState<Editorial[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "create" | "detail">("list");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Editorial | null>(null);

  // Create form state
  const [createLang, setCreateLang] = useState("en");
  const [createContent, setCreateContent] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createImageFiles, setCreateImageFiles] = useState<File[]>([]);
  const [createSubstack, setCreateSubstack] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Action state
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Edit state for translations
  const [editFields, setEditFields] = useState<Record<string, string>>({});

  // Preview state
  const [preview, setPreview] = useState<{
    editorial: { path: string; content: string };
    card: { path: string; content: string };
    images: string[];
  } | null>(null);
  const [previewTab, setPreviewTab] = useState<"rendered" | "source">("rendered");
  const previewRef = useRef<HTMLDivElement>(null);

  async function fetchList() {
    setLoading(true);
    const res = await fetch("/api/editorials");
    const data = await res.json();
    setEditorials(data);
    setLoading(false);
  }

  async function fetchDetail(id: number) {
    const res = await fetch(`/api/editorials/${id}`);
    const data = await res.json();
    setSelected(data);
    setEditFields({
      title_en: data.title_en ?? "",
      title_nl: data.title_nl ?? "",
      title_fr: data.title_fr ?? "",
      summary_en: data.summary_en ?? "",
      summary_nl: data.summary_nl ?? "",
      summary_fr: data.summary_fr ?? "",
    });
  }

  useEffect(() => { fetchList(); }, []);

  function openDetail(id: number) {
    setSelectedId(id);
    setView("detail");
    fetchDetail(id);
  }

  async function handleCreate() {
    setError(""); setSuccess("");
    if (!createContent.trim()) { setError("Please upload or paste markdown content."); return; }

    setBusy("Creating...");
    const images: { filename: string; data: string }[] = [];
    for (const file of createImageFiles) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      images.push({ filename: file.name, data: btoa(binary) });
    }

    const res = await fetch("/api/editorials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: createContent,
        source_language: createLang,
        title: createTitle || undefined,
        images,
        post_to_substack: createSubstack ? 1 : 0,
      }),
    });

    const data = await res.json();
    setBusy("");
    if (!res.ok) { setError(data.error ?? "Failed to create editorial"); return; }

    setSuccess("Editorial created.");
    setCreateContent(""); setCreateTitle(""); setCreateImageFiles([]); setCreateSubstack(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (imageInputRef.current) imageInputRef.current.value = "";
    await fetchList();
    openDetail(data.id);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.endsWith(".md") || file.name.endsWith(".txt") || file.type.startsWith("text/")) {
      const text = await file.text();
      setCreateContent(text);
      const headingMatch = text.match(/^#\s+(.+)/m);
      if (headingMatch && !createTitle) setCreateTitle(headingMatch[1]);
    } else {
      setError("Please upload a .md or .txt file");
    }
  }

  async function handleTranslate() {
    if (!selectedId) return;
    setError(""); setSuccess("");
    setBusy("Translating — this may take a minute...");
    const res = await fetch(`/api/editorials/${selectedId}/translate`, { method: "POST" });
    const data = await res.json();
    setBusy("");
    if (!res.ok) { setError(data.error ?? "Translation failed"); return; }
    setSuccess("Translation complete.");
    await fetchDetail(selectedId);
    await fetchList();
  }

  async function handleSaveEdits() {
    if (!selectedId) return;
    setError(""); setSuccess("");
    setBusy("Saving...");
    const res = await fetch(`/api/editorials/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editFields),
    });
    const data = await res.json();
    setBusy("");
    if (!res.ok) { setError(data.error ?? "Save failed"); return; }
    setSuccess("Saved.");
    await fetchDetail(selectedId);
  }

  async function handlePreview() {
    if (!selectedId) return;
    setError(""); setPreview(null);
    setBusy("Generating preview...");
    const res = await fetch(`/api/editorials/${selectedId}/preview`);
    const data = await res.json();
    setBusy("");
    if (!res.ok) { setError(data.error ?? "Preview failed"); return; }
    setPreview(data);
    setPreviewTab("rendered");
    setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  async function handlePublish() {
    if (!selectedId) return;
    setError(""); setSuccess("");
    setBusy("Publishing...");
    const res = await fetch(`/api/editorials/${selectedId}/publish`, { method: "POST" });
    const data = await res.json();
    setBusy("");
    if (!res.ok) { setError(data.error ?? "Publish failed"); return; }
    setSuccess(`Published! ${data.substackUrl ? `Substack: ${data.substackUrl}` : ""}`);
    await fetchDetail(selectedId);
    await fetchList();
  }

  async function handleDelete(id: number, isPublished: boolean) {
    const msg = isPublished
      ? "This will remove the editorial from the live site and delete it permanently. Continue?"
      : "Delete this editorial?";
    if (!confirm(msg)) return;
    setBusy("Deleting…");
    try {
      const res = await fetch(`/api/editorials/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Delete failed");
        return;
      }
      setView("list");
      setSelected(null);
      await fetchList();
    } finally {
      setBusy("");
    }
  }

  async function handlePostSubstack(id: number) {
    setError(""); setSuccess("");
    setBusy("Posting to Substack…");
    try {
      const res = await fetch(`/api/editorials/${id}/post-substack`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Substack post failed"); return; }
      setSuccess(`Posted to Substack: ${data.url}`);
      await fetchDetail(id);
      await fetchList();
    } finally {
      setBusy("");
    }
  }

  async function handleUnpublish(id: number) {
    if (!confirm("Remove this editorial from the live site? It will return to 'Ready' status so you can re-publish later.")) return;
    setBusy("Unpublishing…");
    try {
      const res = await fetch(`/api/editorials/${id}/unpublish`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Unpublish failed");
        return;
      }
      setSuccess("Editorial unpublished");
      await fetchDetail(id);
      await fetchList();
    } finally {
      setBusy("");
    }
  }

  function renderBadge(status: string) {
    const s = STATUS_BADGE[status] ?? STATUS_BADGE.draft;
    return <span className={`${s.bg} ${s.text} text-xs font-semibold px-2 py-0.5 rounded-full`}>{s.label}</span>;
  }

  // ─── List view ─────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-amber-900">✍️ Editorials</h1>
          <button onClick={() => { setView("create"); setError(""); setSuccess(""); }}
            className="bg-amber-500 hover:bg-amber-600 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors">
            + New Editorial
          </button>
        </div>

        {loading ? (
          <p className="text-amber-600 text-sm">Loading...</p>
        ) : editorials.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-yellow-200 p-8 text-center text-amber-600">
            No editorials yet. Click &ldquo;New Editorial&rdquo; to write one.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {editorials.map(ed => (
              <button key={ed.id} onClick={() => openDetail(ed.id)}
                className="bg-white rounded-xl shadow-sm border border-yellow-200 px-5 py-4 text-left hover:border-yellow-400 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-amber-900 text-sm truncate">
                      {ed.article_emoji ?? "✍️"} {ed.title_en ?? ed.slug}
                    </p>
                    <p className="text-xs text-amber-500 mt-0.5">
                      {new Date(ed.created_at).toLocaleDateString()} · {ed.source_language.toUpperCase()}
                      {ed.published_at && ` · Published ${new Date(ed.published_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  {renderBadge(ed.status)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Create view ───────────────────────────────────────────────────
  if (view === "create") {
    return (
      <div>
        <button onClick={() => setView("list")} className="text-sm text-amber-600 hover:text-amber-800 mb-4">
          ← Back to list
        </button>
        <h1 className="text-2xl font-bold text-amber-900 mb-6">New Editorial</h1>

        {error && <div className="bg-red-100 border border-red-300 text-red-700 text-sm rounded-lg px-4 py-2 mb-4">{error}</div>}
        {success && <div className="bg-green-100 border border-green-300 text-green-700 text-sm rounded-lg px-4 py-2 mb-4">{success}</div>}

        <div className="bg-white rounded-xl shadow-sm border border-yellow-200 p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-amber-800 mb-1">Source language</label>
            <select value={createLang} onChange={e => setCreateLang(e.target.value)}
              className="border border-yellow-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-500">
              {LANG_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-amber-800 mb-1">Title (optional — auto-extracted from # heading)</label>
            <input value={createTitle} onChange={e => setCreateTitle(e.target.value)}
              className="w-full border border-yellow-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-500"
              placeholder="Editorial title" />
          </div>

          <div>
            <label className="block text-sm font-medium text-amber-800 mb-1">Upload markdown file</label>
            <input ref={fileInputRef} type="file" accept=".md,.txt,text/*" onChange={handleFileUpload}
              className="text-sm text-amber-700" />
          </div>

          <div>
            <label className="block text-sm font-medium text-amber-800 mb-1">
              Content {createContent ? `(${createContent.length.toLocaleString()} chars)` : ""}
            </label>
            <textarea value={createContent} onChange={e => setCreateContent(e.target.value)}
              rows={12}
              className="w-full border border-yellow-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-yellow-500"
              placeholder="Paste or upload your editorial markdown here..." />
          </div>

          <div>
            <label className="block text-sm font-medium text-amber-800 mb-1">
              Illustrations (optional) — referenced in the markdown as <code className="text-xs bg-amber-100 px-1 rounded">![alt](filename.jpg)</code>
            </label>
            <input ref={imageInputRef} type="file" accept="image/*" multiple
              onChange={e => setCreateImageFiles(Array.from(e.target.files ?? []))}
              className="text-sm text-amber-700" />
            {createImageFiles.length > 0 && (
              <p className="text-xs text-amber-500 mt-1">{createImageFiles.length} file{createImageFiles.length !== 1 ? "s" : ""}: {createImageFiles.map(f => f.name).join(", ")}</p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-amber-800">
            <input type="checkbox" checked={createSubstack} onChange={e => setCreateSubstack(e.target.checked)}
              className="rounded" />
            Post to Substack on publish
          </label>

          <div className="flex gap-3 pt-2">
            <button onClick={handleCreate} disabled={!!busy}
              className="bg-amber-500 hover:bg-amber-600 text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
              {busy || "Create Editorial"}
            </button>
            <button onClick={() => setView("list")} className="text-sm text-amber-600 hover:text-amber-800">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Detail view ───────────────────────────────────────────────────
  if (view === "detail" && selected) {
    const isDraft = selected.status === "draft";
    const isReady = selected.status === "ready";
    const isPublished = selected.status === "published";

    return (
      <div>
        <button onClick={() => { setView("list"); setSelected(null); }} className="text-sm text-amber-600 hover:text-amber-800 mb-4">
          ← Back to list
        </button>

        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-2xl font-bold text-amber-900">
            {selected.article_emoji ?? "✍️"} {selected.title_en ?? selected.slug}
          </h1>
          {renderBadge(selected.status)}
        </div>

        {error && <div className="bg-red-100 border border-red-300 text-red-700 text-sm rounded-lg px-4 py-2 mb-4">{error}</div>}
        {success && <div className="bg-green-100 border border-green-300 text-green-700 text-sm rounded-lg px-4 py-2 mb-4">{success}</div>}
        {busy && <div className="bg-blue-100 border border-blue-300 text-blue-700 text-sm rounded-lg px-4 py-2 mb-4 animate-pulse">{busy}</div>}

        {/* Action bar */}
        <div className="flex flex-wrap gap-3 mb-6">
          {isDraft && (
            <button onClick={handleTranslate} disabled={!!busy}
              className="bg-blue-500 hover:bg-blue-600 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
              🌐 Translate &amp; Summarise
            </button>
          )}
          {isReady && (
            <>
              <button onClick={handleTranslate} disabled={!!busy}
                className="bg-blue-400 hover:bg-blue-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
                🔄 Re-translate
              </button>
              <button onClick={handlePreview} disabled={!!busy}
                className="bg-purple-500 hover:bg-purple-600 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
                👁 Preview
              </button>
              <button onClick={handlePublish} disabled={!!busy}
                className="bg-green-500 hover:bg-green-600 text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
                🚀 Publish
              </button>
            </>
          )}
          {isPublished && (
            <>
              {!selected.substack_posted_at && (
                <button onClick={() => handlePostSubstack(selected.id)} disabled={!!busy}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
                  📨 Post to Substack
                </button>
              )}
              <button onClick={() => handleUnpublish(selected.id)} disabled={!!busy}
                className="bg-orange-100 hover:bg-orange-200 text-orange-700 font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
                ↩ Unpublish
              </button>
            </>
          )}
          <button onClick={() => handleDelete(selected.id, isPublished)} disabled={!!busy}
            className="bg-red-100 hover:bg-red-200 text-red-700 font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
            🗑 Delete
          </button>
        </div>

        {/* Metadata */}
        <div className="bg-white rounded-xl shadow-sm border border-yellow-200 p-5 mb-4">
          <h2 className="text-sm font-semibold text-amber-800 mb-3">Details</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-amber-700">
            <div><span className="text-amber-500">Slug:</span> {selected.slug}</div>
            <div><span className="text-amber-500">Language:</span> {selected.source_language.toUpperCase()}</div>
            <div><span className="text-amber-500">Created:</span> {new Date(selected.created_at).toLocaleString()}</div>
            {selected.published_at && <div><span className="text-amber-500">Published:</span> {new Date(selected.published_at).toLocaleString()}</div>}
            {selected.substack_posted_at && <div><span className="text-amber-500">Substack:</span> {new Date(selected.substack_posted_at).toLocaleString()}</div>}
            {selected.image_filename && (() => {
              let names: string[] = [];
              try { const arr = JSON.parse(selected.image_filename); names = Array.isArray(arr) ? arr : [selected.image_filename]; } catch { names = [selected.image_filename]; }
              return names.length > 0 ? <div className="col-span-2 md:col-span-4"><span className="text-amber-500">Images:</span> {names.join(", ")}</div> : null;
            })()}
          </div>
        </div>

        {/* Titles & Summaries (editable when not published) */}
        {(isReady || isPublished) && (
          <div className="bg-white rounded-xl shadow-sm border border-yellow-200 p-5 mb-4">
            <h2 className="text-sm font-semibold text-amber-800 mb-3">Titles &amp; Summaries</h2>
            <div className="space-y-3">
              {(["en", "nl", "fr"] as const).map(lang => (
                <div key={lang} className="space-y-1">
                  <label className="text-xs font-medium text-amber-600 uppercase">{lang} title</label>
                  <input
                    value={editFields[`title_${lang}`] ?? ""}
                    onChange={e => setEditFields({ ...editFields, [`title_${lang}`]: e.target.value })}
                    disabled={isPublished}
                    className="w-full border border-yellow-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-yellow-500 disabled:bg-gray-50"
                  />
                  <label className="text-xs font-medium text-amber-600 uppercase">{lang} summary</label>
                  <textarea
                    value={editFields[`summary_${lang}`] ?? ""}
                    onChange={e => setEditFields({ ...editFields, [`summary_${lang}`]: e.target.value })}
                    disabled={isPublished}
                    rows={3}
                    className="w-full border border-yellow-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-yellow-500 disabled:bg-gray-50"
                  />
                </div>
              ))}
              {isReady && (
                <button onClick={handleSaveEdits} disabled={!!busy}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
                  Save Changes
                </button>
              )}
            </div>
          </div>
        )}

        {/* Substack Note */}
        {(isReady || isPublished) && selected.title_en && selected.summary_en && (
          <SubstackNote editorial={selected} />
        )}

        {/* Content preview */}
        {(["en", "nl", "fr"] as const).map(lang => {
          const content = selected[`content_${lang}`];
          if (!content) return null;
          return (
            <details key={lang} className="bg-white rounded-xl shadow-sm border border-yellow-200 mb-4">
              <summary className="px-5 py-3 text-sm font-medium text-amber-800 cursor-pointer hover:bg-yellow-50">
                📄 Content — {lang.toUpperCase()} ({content.length.toLocaleString()} chars)
              </summary>
              <div className="px-5 pb-4">
                <pre className="whitespace-pre-wrap text-xs text-amber-700 font-mono max-h-96 overflow-y-auto bg-amber-50 rounded-lg p-3">
                  {content}
                </pre>
              </div>
            </details>
          );
        })}

        {/* Publish preview */}
        {preview && (
          <div ref={previewRef} className="bg-white rounded-xl shadow-sm border-2 border-purple-300 p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-purple-800">👁 Preview</h2>
              <button onClick={() => setPreview(null)} className="text-xs text-purple-500 hover:text-purple-700">Dismiss</button>
            </div>

            <div className="flex gap-1 mb-4 border-b border-purple-200">
              <button onClick={() => setPreviewTab("rendered")}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${previewTab === "rendered" ? "bg-purple-100 text-purple-800 border border-purple-200 border-b-white -mb-px" : "text-purple-500 hover:text-purple-700"}`}>
                Rendered
              </button>
              <button onClick={() => setPreviewTab("source")}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${previewTab === "source" ? "bg-purple-100 text-purple-800 border border-purple-200 border-b-white -mb-px" : "text-purple-500 hover:text-purple-700"}`}>
                Source files
              </button>
            </div>

            {previewTab === "rendered" && selected && (
              <div className="border border-purple-200 rounded-lg overflow-hidden">
                <div style={{
                  background: "#fffbeb",
                  padding: "1.5rem",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  maxHeight: "70vh",
                  overflowY: "auto",
                }}>
                  <EditorialRenderedPreview editorial={selected} />
                </div>
              </div>
            )}

            {previewTab === "source" && (
              <div>
                <p className="text-xs text-purple-600 mb-4">
                  Files that will be committed to GitHub on publish. Nothing has been sent yet.
                </p>

                {preview.images.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-xs font-semibold text-purple-700 uppercase mb-1">Images ({preview.images.length})</h3>
                    <ul className="text-xs text-amber-700 list-disc list-inside">
                      {preview.images.map(p => <li key={p}>{p}</li>)}
                    </ul>
                  </div>
                )}

                <details open className="mb-4">
                  <summary className="text-xs font-semibold text-purple-700 uppercase cursor-pointer mb-1">
                    Editorial page — <code className="font-normal">{preview.editorial.path}</code>
                  </summary>
                  <pre className="whitespace-pre-wrap text-xs text-amber-700 font-mono max-h-96 overflow-y-auto bg-purple-50 rounded-lg p-3 mt-1">
                    {preview.editorial.content}
                  </pre>
                </details>

                <details className="mb-2">
                  <summary className="text-xs font-semibold text-purple-700 uppercase cursor-pointer mb-1">
                    Homepage card — <code className="font-normal">{preview.card.path}</code>
                  </summary>
                  <pre className="whitespace-pre-wrap text-xs text-amber-700 font-mono max-h-96 overflow-y-auto bg-purple-50 rounded-lg p-3 mt-1">
                    {preview.card.content}
                  </pre>
                </details>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return <p className="text-amber-600 text-sm">Loading editorial...</p>;
}

function simpleMarkdownToHtml(md: string): string {
  let html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^> (.+)$/gm, "<blockquote><p>$1</p></blockquote>")
    .replace(/^---+$/gm, "<hr />");

  const lines = html.split("\n");
  const result: string[] = [];
  let inList = false;
  let listType = "";

  for (const line of lines) {
    const ulMatch = line.match(/^[-*] (.+)/);
    const olMatch = line.match(/^\d+\. (.+)/);

    if (ulMatch) {
      if (!inList || listType !== "ul") { if (inList) result.push(`</${listType}>`); result.push("<ul>"); inList = true; listType = "ul"; }
      result.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (!inList || listType !== "ol") { if (inList) result.push(`</${listType}>`); result.push("<ol>"); inList = true; listType = "ol"; }
      result.push(`<li>${olMatch[1]}</li>`);
    } else {
      if (inList) { result.push(`</${listType}>`); inList = false; }
      if (line.trim() === "" || line.startsWith("<h") || line.startsWith("<blockquote") || line.startsWith("<hr")) {
        result.push(line);
      } else if (line.trim()) {
        result.push(`<p>${line}</p>`);
      }
    }
  }
  if (inList) result.push(`</${listType}>`);

  return result.join("\n").replace(/<\/blockquote>\n<blockquote>/g, "\n");
}

function SubstackNote({ editorial }: { editorial: Editorial }) {
  const [copied, setCopied] = useState(false);
  const title = editorial.title_en ?? "Untitled";
  const summary = editorial.summary_en ?? "";
  const slug = editorial.slug;
  const emoji = editorial.article_emoji ?? "✍️";
  const url = `https://positron.today/editorials/${slug}/`;

  const firstSentence = summary.split(/(?<=[.!?])\s+/)[0] ?? summary;

  const noteText = `${emoji} New editorial: "${title}"

${firstSentence}

Read the full editorial on Positron.today:
${url}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(noteText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-yellow-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-amber-800">📝 Substack Note</h2>
        <button onClick={handleCopy}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${copied ? "bg-green-100 text-green-700" : "bg-amber-100 hover:bg-amber-200 text-amber-700"}`}>
          {copied ? "✓ Copied!" : "Copy to clipboard"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap text-sm text-amber-900 bg-amber-50 rounded-lg p-4 font-sans leading-relaxed border border-amber-100">
        {noteText}
      </pre>
    </div>
  );
}

function rewriteImageSrcs(html: string, editorialId: number): string {
  return html.replace(/<img\s+src="([^"]+)"/g, (_match, src) => {
    if (src.startsWith("http") || src.startsWith("/")) return `<img src="${src}"`;
    const filename = src.split("/").pop();
    return `<img src="/api/editorials/${editorialId}/image/${filename}"`;
  });
}

function EditorialRenderedPreview({ editorial }: { editorial: Editorial }) {
  const emoji = editorial.article_emoji ?? "✍️";
  const title = editorial.title_en ?? editorial.slug;
  const titleNl = editorial.title_nl ?? title;
  const titleFr = editorial.title_fr ?? title;
  const contentHtml = rewriteImageSrcs(simpleMarkdownToHtml(editorial.content_en ?? ""), editorial.id);
  const date = new Date(editorial.created_at).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });

  return (
    <>
      <style>{`
        .ep-header { background:#f3e8ff; border:2px solid #c084fc; border-radius:1rem; padding:1.1rem; margin-bottom:1.25rem; }
        .ep-emoji { font-size:2rem; margin-bottom:0.4rem; }
        .ep-title { font-size:1.35rem; font-weight:700; color:#581c87; line-height:1.3; margin-bottom:0.6rem; }
        .ep-meta { font-size:0.8rem; color:#7e22ce; }
        .ep-author { font-weight:600; }
        .ep-body { background:white; border-radius:1rem; padding:1.1rem; border:2px solid #c084fc; font-size:0.925rem; line-height:1.75; color:#451a03; }
        .ep-body h1 { font-size:1.35rem; font-weight:700; color:#581c87; margin:1.5rem 0 0.75rem; }
        .ep-body h2 { font-size:1.25rem; font-weight:700; color:#581c87; margin:1.5rem 0 0.75rem; }
        .ep-body h3 { font-size:1.1rem; font-weight:600; color:#581c87; margin:1.25rem 0 0.5rem; }
        .ep-body p { margin-bottom:1rem; }
        .ep-body ul, .ep-body ol { margin-bottom:1rem; padding-left:1.5rem; }
        .ep-body li { margin-bottom:0.35rem; }
        .ep-body a { color:#7e22ce; text-decoration:underline; }
        .ep-body img { max-width:100%; border-radius:0.5rem; margin:1rem 0; }
        .ep-body blockquote { border-left:3px solid #c084fc; padding-left:1rem; color:#7e22ce; font-style:italic; margin:1rem 0; }
        .ep-body hr { border:none; border-top:1px solid #c084fc; margin:1.5rem 0; }
        .ep-lang-tabs { display:flex; gap:0.5rem; margin-bottom:1rem; }
        .ep-lang-tab { padding:0.3rem 0.7rem; border-radius:0.375rem; font-size:0.75rem; font-weight:600; cursor:pointer; border:1px solid #c084fc; background:transparent; color:#7e22ce; }
        .ep-lang-tab.active { background:#581c87; color:white; border-color:#581c87; }
      `}</style>

      <div className="ep-header">
        <div className="ep-emoji">{emoji}</div>
        <h1 className="ep-title">{title}</h1>
        <p className="ep-meta">
          <span className="ep-author">By Rik Van Bruggen</span> · {date}
        </p>
      </div>

      <div className="ep-body" dangerouslySetInnerHTML={{ __html: contentHtml }} />

      {(editorial.content_nl || editorial.content_fr) && (
        <details className="mt-4">
          <summary className="text-xs text-purple-600 cursor-pointer hover:text-purple-800">
            View NL/FR translations
          </summary>
          <div className="mt-2 space-y-3">
            {editorial.content_nl && (
              <div>
                <p className="text-xs font-semibold text-purple-700 mb-1">🇳🇱 {titleNl}</p>
                <div className="ep-body text-sm" dangerouslySetInnerHTML={{ __html: rewriteImageSrcs(simpleMarkdownToHtml(editorial.content_nl), editorial.id) }} />
              </div>
            )}
            {editorial.content_fr && (
              <div>
                <p className="text-xs font-semibold text-purple-700 mb-1">🇫🇷 {titleFr}</p>
                <div className="ep-body text-sm" dangerouslySetInnerHTML={{ __html: rewriteImageSrcs(simpleMarkdownToHtml(editorial.content_fr), editorial.id) }} />
              </div>
            )}
          </div>
        </details>
      )}
    </>
  );
}
