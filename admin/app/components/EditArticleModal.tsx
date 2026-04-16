"use client";

import { useState } from "react";

export type EditableFields = {
  title_en: string;
  title_nl: string;
  title_fr: string;
  summary_en: string;
  summary_nl: string;
  summary_fr: string;
  article_emoji: string;
  featured: boolean;
};

type Props = {
  articleId: number;
  initial: EditableFields;
  isPublished: boolean;
  onClose: () => void;
  onSaved: (fields: EditableFields) => void;
};

export default function EditArticleModal({ articleId, initial, isPublished, onClose, onSaved }: Props) {
  const [fields, setFields] = useState<EditableFields>({ ...initial });
  const [lang, setLang] = useState<"en" | "nl" | "fr">("en");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(key: keyof EditableFields, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function save(andRepublish: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/articles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: articleId, content: fields }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Save failed"); setSaving(false); return; }

      if (andRepublish) {
        const pubRes = await fetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: articleId }),
        });
        const pubData = await pubRes.json();
        if (!pubRes.ok) { setError(pubData.error ?? "Republish failed"); setSaving(false); return; }
      }

      onSaved(fields);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-yellow-100">
          <h2 className="text-lg font-bold text-amber-900">Edit Article</h2>
          <button
            onClick={onClose}
            className="text-amber-400 hover:text-amber-700 text-xl leading-none transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Emoji */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide w-16 shrink-0">
              Emoji
            </label>
            <input
              type="text"
              value={fields.article_emoji}
              onChange={(e) => update("article_emoji", e.target.value)}
              className="border border-yellow-200 rounded-lg px-3 py-1.5 text-lg w-20 text-center focus:outline-none focus:border-yellow-400"
              maxLength={4}
            />
          </div>

          {/* Featured toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!fields.featured}
              onChange={(e) => setFields((f) => ({ ...f, featured: e.target.checked }))}
              className="accent-yellow-500"
            />
            <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
              ⭐ Featured (wide card on public site)
            </span>
          </label>

          {/* Language tabs */}
          <div className="flex gap-1 border-b border-yellow-100">
            {(["en", "nl", "fr"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-4 py-1.5 text-sm font-semibold uppercase rounded-t transition-colors ${
                  lang === l
                    ? "bg-yellow-100 text-amber-900 border border-b-white border-yellow-200 -mb-px"
                    : "text-amber-500 hover:text-amber-800"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
              Title ({lang.toUpperCase()})
            </label>
            <input
              type="text"
              value={fields[`title_${lang}`]}
              onChange={(e) => update(`title_${lang}`, e.target.value)}
              className="border border-yellow-200 rounded-lg px-3 py-2 text-sm text-amber-900 focus:outline-none focus:border-yellow-400 w-full"
            />
          </div>

          {/* Summary */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
              Summary ({lang.toUpperCase()})
            </label>
            <textarea
              value={fields[`summary_${lang}`]}
              onChange={(e) => update(`summary_${lang}`, e.target.value)}
              rows={6}
              className="border border-yellow-200 rounded-lg px-3 py-2 text-sm text-amber-900 focus:outline-none focus:border-yellow-400 w-full resize-y leading-relaxed"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-yellow-100 gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-sm text-amber-500 hover:text-amber-700 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => save(false)}
              disabled={saving}
              className="bg-yellow-100 hover:bg-yellow-200 text-amber-900 font-medium px-4 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {isPublished && (
              <button
                onClick={() => save(true)}
                disabled={saving}
                className="bg-green-400 hover:bg-green-500 text-green-900 font-medium px-4 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save & Republish →"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
