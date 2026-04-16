"use client";

import { useState } from "react";
import EditArticleModal, { type EditableFields } from "@/app/components/EditArticleModal";

type ArticleTag = { id: number; name: string; emoji: string };

type Article = {
  id: number;
  status: string;
  source_url: string;
  source_name: string;
  raw_title: string | null;
  article_emoji: string | null;
  tags: ArticleTag[];
  title_en: string | null;
  title_nl: string | null;
  title_fr: string | null;
  summary_en: string | null;
  summary_nl: string | null;
  summary_fr: string | null;
  publish_date: string | null;
  post_to_social_on_publish: boolean;
  featured: boolean;
  positivity_score: number | null;
};

function TagPills({
  articleId,
  articleTags,
  allTags,
  onToggle,
  selectedOnly = false,
}: {
  articleId: number;
  articleTags: ArticleTag[];
  allTags: ArticleTag[];
  onToggle: (articleId: number, tag: ArticleTag, selected: boolean) => void;
  selectedOnly?: boolean;
}) {
  if (allTags.length === 0) return null;
  const selectedIds = new Set(articleTags.map((t) => t.id));
  const visibleTags = selectedOnly ? allTags.filter((t) => selectedIds.has(t.id)) : allTags;
  if (visibleTags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {visibleTags.map((tag) => {
        const sel = selectedIds.has(tag.id);
        return (
          <button
            key={tag.id}
            onClick={() => onToggle(articleId, tag, sel)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              sel
                ? "bg-yellow-400 border-yellow-500 text-amber-900 font-semibold"
                : "bg-white border-yellow-200 text-amber-600 hover:border-yellow-400"
            }`}
          >
            {tag.emoji} {tag.name}
          </button>
        );
      })}
    </div>
  );
}

export default function ScheduledClient({
  initialArticles,
  tags,
}: {
  initialArticles: Article[];
  tags: ArticleTag[];
}) {
  const [articles, setArticles] = useState<Article[]>(initialArticles);
  const [summarising, setSummarising] = useState<Set<number>>(new Set());
  const [summarisingAll, setSummarisingAll] = useState(false);
  const [publishing, setPublishing] = useState<Set<number>>(new Set());
  const [published, setPublished] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [previewLang, setPreviewLang] = useState<"en" | "nl" | "fr">("en");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestInterval, setSuggestInterval] = useState(30);

  function toggleTag(articleId: number, tag: ArticleTag, wasSelected: boolean) {
    setArticles((prev) =>
      prev.map((a) => {
        if (a.id !== articleId) return a;
        const newTags = wasSelected
          ? a.tags.filter((t) => t.id !== tag.id)
          : [...a.tags, tag];
        // Persist asynchronously
        fetch("/api/articles", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: articleId, tags: newTags.map((t) => t.id) }),
        });
        return { ...a, tags: newTags };
      })
    );
  }

  async function remove(id: number) {
    await fetch(`/api/articles?id=${id}`, { method: "DELETE" });
    setArticles((prev) => prev.filter((a) => a.id !== id));
  }

  async function setSocialFlag(id: number, value: boolean) {
    setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, post_to_social_on_publish: value } : a)));
    await fetch("/api/articles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, post_to_social_on_publish: value }),
    });
  }

  async function setFeatured(id: number, value: boolean) {
    setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, featured: value } : a)));
    await fetch("/api/articles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, featured: value }),
    });
  }

  async function setDate(id: number, value: string) {
    // datetime-local returns "YYYY-MM-DDTHH:MM" — store as-is (SQLite accepts this)
    await fetch("/api/articles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, publish_date: value }),
    });
    setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, publish_date: value } : a)));
  }

  /** Format a stored publish_date value into the "YYYY-MM-DDTHH:MM" shape
   *  that datetime-local inputs expect. */
  function toDatetimeLocal(raw: string | null): string {
    if (!raw) return new Date().toISOString().slice(0, 16);
    if (raw.includes("T")) return raw.slice(0, 16);
    return raw.replace(" ", "T").slice(0, 16);
  }

  /** Returns true if the article's publish_date is set and is still in the future. */
  function isQueued(raw: string | null): boolean {
    if (!raw) return false;
    const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
    return d > new Date();
  }

  /** Human-readable countdown: "in 25 min", "in 2h 15m", "in 3d" */
  function timeUntil(raw: string): string {
    const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
    const diffMs = d.getTime() - Date.now();
    if (diffMs <= 0) return "now";
    const mins  = Math.floor(diffMs / 60000);
    const hours = Math.floor(mins / 60);
    const days  = Math.floor(hours / 24);
    if (days >= 1)  return `in ${days}d ${hours % 24}h`;
    if (hours >= 1) return `in ${hours}h ${mins % 60}m`;
    return `in ${mins} min`;
  }

  /** Format a publish_date for display: "13 Apr, 08:30" */
  function formatSlot(raw: string): string {
    const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
      ", " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  async function suggestSchedule() {
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch("/api/suggest-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval_minutes: suggestInterval }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `Server error ${res.status}`); return; }
      if (data.scheduled === 0) {
        setError("All articles already have a scheduled time.");
        return;
      }
      // Apply the returned slots to local state
      const slotMap = new Map<number, string>(data.slots.map((s: { id: number; publish_date: string }) => [s.id, s.publish_date]));
      setArticles((prev) => prev.map((a) => slotMap.has(a.id) ? { ...a, publish_date: slotMap.get(a.id)! } : a));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setSuggesting(false);
    }
  }

  async function summariseAll() {
    // Snapshot IDs up front: summarise() mutates article status to "scheduled"
    // so the draft filter shrinks mid-loop otherwise.
    const pending = articles.filter((a) => a.status === "draft").map((a) => a.id);
    if (pending.length === 0) return;
    setSummarisingAll(true);
    setError(null);
    for (const id of pending) {
      await summarise(id);
    }
    setSummarisingAll(false);
  }

  async function summarise(id: number) {
    setSummarising((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const res = await fetch("/api/summarise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const text = await res.text();
      // Vercel may return HTML on timeout — detect and show friendly error
      if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
        setError(`Summarise timed out for article ${id}. Try again — it may work on retry.`);
        return;
      }
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) { setError(data.error ?? `Server error ${res.status}`); return; }
      setArticles((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                status: "scheduled",
                article_emoji: data.emoji ?? a.article_emoji,
                title_en: data.title_en, title_nl: data.title_nl, title_fr: data.title_fr,
                summary_en: data.summary_en, summary_nl: data.summary_nl, summary_fr: data.summary_fr,
                tags: Array.isArray(data.matched_tags) ? data.matched_tags : a.tags,
              }
            : a
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setSummarising((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  async function publish(id: number) {
    setPublishing((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `Publish failed: ${res.status}`); return; }
      setPublished((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setArticles((prev) => prev.filter((a) => a.id !== id));
        setPublished((prev) => { const s = new Set(prev); s.delete(id); return s; });
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    }
    setPublishing((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

    const TRANSLATION_FIELDS: (keyof Article)[] = [
    "title_en", "title_nl", "title_fr",
    "summary_en", "summary_nl", "summary_fr",
  ];
  function missingTranslations(a: Article): string[] {
    return TRANSLATION_FIELDS.filter((f) => !a[f]);
  }

  const drafts = articles.filter((a) => a.status === "draft");
  const scheduled = articles.filter((a) => a.status === "scheduled");
  const titleKey = `title_${previewLang}` as keyof Article;
  const summaryKey = `summary_${previewLang}` as keyof Article;

  return (
    <div>
      <h1 className="text-2xl font-bold text-amber-900 mb-1">Scheduled</h1>
      <p className="text-amber-700 text-sm mb-8">
        Approved articles waiting for summarisation or publishing.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700 mb-6">
          {error}
        </div>
      )}

      {articles.length === 0 ? (
        <p className="text-amber-600 text-sm">
          Nothing here yet. Approve articles in Preview to queue them.
        </p>
      ) : (
        <div className="flex flex-col gap-8">

          {/* ── Drafts ── */}
          {drafts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wide">
                  Drafts — needs summarisation ({drafts.length})
                </h2>
                {drafts.length > 1 && (
                  <button
                    onClick={summariseAll}
                    disabled={summarisingAll || summarising.size > 0}
                    className="bg-yellow-400 hover:bg-yellow-500 text-amber-900 font-semibold px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {summarisingAll ? `Summarising… (${drafts.length} left)` : `✨ Summarise all (${drafts.length})`}
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-3">
                {drafts.map((a) => (
                  <div key={a.id} className="bg-white rounded-xl px-5 py-4 shadow-sm border border-yellow-200">
                    <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <a
                          href={a.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-amber-900 text-sm hover:text-amber-600 transition-colors block leading-snug"
                        >
                          {a.raw_title ?? a.source_url}
                        </a>
                        <p className="text-xs text-amber-500 mt-0.5">{a.source_name}</p>
                      </div>
                      <div className="flex gap-2 sm:shrink-0 items-start flex-wrap">
                        <button
                          onClick={() => summarise(a.id)}
                          disabled={summarising.has(a.id) || summarisingAll}
                          className="bg-yellow-400 hover:bg-yellow-500 text-amber-900 font-medium px-4 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {summarising.has(a.id) ? "Summarising..." : "Summarise ✨"}
                        </button>
                        <button
                          onClick={() => remove(a.id)}
                          disabled={summarising.has(a.id) || summarisingAll}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50 mt-1.5"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Scheduled ── */}
          {scheduled.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wide">
                  Ready to publish ({scheduled.length})
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Suggest Schedule */}
                  <div className="flex items-center gap-1.5 bg-white border border-yellow-200 rounded-lg px-2 py-1">
                    <span className="text-xs text-amber-600">Every</span>
                    <select
                      value={suggestInterval}
                      onChange={(e) => setSuggestInterval(Number(e.target.value))}
                      className="text-xs text-amber-800 border-none bg-transparent focus:outline-none font-medium"
                    >
                      {[15, 30, 45, 60, 90, 120].map((m) => (
                        <option key={m} value={m}>{m} min</option>
                      ))}
                    </select>
                    <button
                      onClick={suggestSchedule}
                      disabled={suggesting}
                      className="text-xs bg-amber-400 hover:bg-amber-500 text-amber-900 font-semibold px-2.5 py-0.5 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {suggesting ? "Scheduling…" : "📅 Suggest schedule"}
                    </button>
                  </div>
                  {/* Language switcher */}
                  <div className="flex gap-1">
                    {(["en", "nl", "fr"] as const).map((lang) => (
                      <button
                        key={lang}
                        onClick={() => setPreviewLang(lang)}
                        className={`text-xs px-2 py-1 rounded font-medium uppercase transition-colors ${
                          previewLang === lang ? "bg-yellow-400 text-amber-900" : "text-amber-600 hover:text-amber-900"
                        }`}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {scheduled.map((a) => (
                  <div key={a.id} className={`bg-white rounded-xl px-5 py-4 shadow-sm border ${missingTranslations(a).length > 0 ? "border-orange-300" : "border-yellow-200"}`}>
                    {missingTranslations(a).length > 0 && (
                      <div className="flex items-center gap-1.5 mb-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5">
                        <span>⚠️</span>
                        <span>Missing translations: {missingTranslations(a).join(", ")}</span>
                        <button
                          onClick={() => summarise(a.id)}
                          disabled={summarising.has(a.id)}
                          className="ml-auto bg-orange-400 hover:bg-orange-500 text-white font-medium px-2.5 py-0.5 rounded text-xs transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {summarising.has(a.id) ? "Re-summarising..." : "Re-summarise ✨"}
                        </button>
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          {a.article_emoji && (
                            <span className="text-xl shrink-0 leading-snug">{a.article_emoji}</span>
                          )}
                          <div className="min-w-0">
                            <a
                              href={a.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-amber-900 text-sm hover:text-amber-600 transition-colors block leading-snug"
                            >
                              {String(a[titleKey] ?? a.source_url)}
                            </a>
                            <p className="text-xs text-amber-600 leading-relaxed mt-1">
                              {String(a[summaryKey] ?? "")}
                            </p>
                            <p className="text-xs text-amber-400 mt-1">
                              {a.source_name}
                              {a.positivity_score != null && (
                                <span
                                  className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    a.positivity_score >= 8
                                      ? "bg-green-100 text-green-700"
                                      : a.positivity_score >= 6
                                      ? "bg-yellow-100 text-yellow-700"
                                      : "bg-orange-100 text-orange-700"
                                  }`}
                                  title={`Positivity score: ${a.positivity_score}/10`}
                                >
                                  ☀️ {a.positivity_score}/10
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <TagPills
                          articleId={a.id}
                          articleTags={a.tags}
                          allTags={tags}
                          onToggle={toggleTag}
                          selectedOnly
                        />
                      </div>
                      <div className="flex flex-col sm:items-end gap-2 w-full sm:w-auto sm:shrink-0">
                        <input
                          type="datetime-local"
                          value={toDatetimeLocal(a.publish_date ?? null)}
                          onChange={(e) => setDate(a.id, e.target.value)}
                          className="border border-yellow-200 rounded px-2 py-1 text-xs text-amber-800 focus:outline-none focus:border-yellow-400"
                        />
                        <div className="flex flex-col gap-1">
                          <label
                            title="When this article publishes, also announce it on social media"
                            className="flex items-center gap-1.5 text-xs text-amber-700 cursor-pointer select-none"
                          >
                            <input
                              type="checkbox"
                              checked={!!a.post_to_social_on_publish}
                              onChange={(e) => setSocialFlag(a.id, e.target.checked)}
                              className="accent-yellow-500"
                            />
                            📣 Announce on social
                          </label>
                          <label
                            title="Display this article spanning two columns on the public site"
                            className="flex items-center gap-1.5 text-xs text-amber-700 cursor-pointer select-none"
                          >
                            <input
                              type="checkbox"
                              checked={!!a.featured}
                              onChange={(e) => setFeatured(a.id, e.target.checked)}
                              className="accent-yellow-500"
                            />
                            ⭐ Featured (wide card)
                          </label>
                        </div>

                        {isQueued(a.publish_date ?? null) ? (
                          /* ── Queued: waiting for cron ── */
                          <div className="flex flex-col items-end gap-1.5">
                            <span className="text-xs bg-sky-50 border border-sky-200 text-sky-700 rounded-lg px-2.5 py-1 font-medium whitespace-nowrap">
                              ⏰ {formatSlot(a.publish_date!)} · {timeUntil(a.publish_date!)}
                            </span>
                            <div className="flex gap-2 items-center">
                              <button
                                onClick={() => setEditingId(a.id)}
                                disabled={publishing.has(a.id)}
                                className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50 font-medium"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => publish(a.id)}
                                disabled={publishing.has(a.id) || published.has(a.id)}
                                title="Override: publish immediately without waiting for the scheduled time"
                                className="text-xs text-amber-500 hover:text-amber-800 underline transition-colors disabled:opacity-50 whitespace-nowrap"
                              >
                                {published.has(a.id) ? "Published! ✓" : publishing.has(a.id) ? "Publishing…" : "publish now ↑"}
                              </button>
                              <button
                                onClick={() => remove(a.id)}
                                disabled={publishing.has(a.id)}
                                className="text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* ── Ready: publish manually now ── */
                          <div className="flex gap-2">
                            <button
                              onClick={() => setEditingId(a.id)}
                              disabled={publishing.has(a.id)}
                              className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50 font-medium"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => publish(a.id)}
                              disabled={publishing.has(a.id) || published.has(a.id)}
                              className="bg-green-400 hover:bg-green-500 text-green-900 font-medium px-3 py-1 rounded-lg text-xs transition-colors disabled:opacity-50"
                            >
                              {published.has(a.id) ? "Published! ✓" : publishing.has(a.id) ? "Publishing..." : "Publish →"}
                            </button>
                            <button
                              onClick={() => remove(a.id)}
                              disabled={publishing.has(a.id)}
                              className="text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {editingId !== null && (() => {
        const a = articles.find((x) => x.id === editingId);
        if (!a) return null;
        return (
          <EditArticleModal
            articleId={a.id}
            isPublished={false}
            initial={{
              title_en: a.title_en ?? "",
              title_nl: a.title_nl ?? "",
              title_fr: a.title_fr ?? "",
              summary_en: a.summary_en ?? "",
              summary_nl: a.summary_nl ?? "",
              summary_fr: a.summary_fr ?? "",
              article_emoji: a.article_emoji ?? "✨",
              featured: !!a.featured,
            }}
            onClose={() => setEditingId(null)}
            onSaved={(fields: EditableFields) => {
              setArticles((prev) => prev.map((x) =>
                x.id === editingId ? { ...x, ...fields } : x
              ));
            }}
          />
        );
      })()}
    </div>
  );
}
