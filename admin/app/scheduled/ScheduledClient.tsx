"use client";

import { useState } from "react";

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
};

function TagPills({
  articleId,
  articleTags,
  allTags,
  onToggle,
}: {
  articleId: number;
  articleTags: ArticleTag[];
  allTags: ArticleTag[];
  onToggle: (articleId: number, tag: ArticleTag, selected: boolean) => void;
}) {
  if (allTags.length === 0) return null;
  const selectedIds = new Set(articleTags.map((t) => t.id));
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {allTags.map((tag) => {
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
  const [summarising, setSummarising] = useState<number | null>(null);
  const [publishing, setPublishing] = useState<Set<number>>(new Set());
  const [published, setPublished] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [previewLang, setPreviewLang] = useState<"en" | "nl" | "fr">("en");

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

  async function setDate(id: number, date: string) {
    await fetch("/api/articles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, publish_date: date }),
    });
    setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, publish_date: date } : a)));
  }

  async function summarise(id: number) {
    setSummarising(id);
    setError(null);
    try {
      const res = await fetch("/api/summarise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const text = await res.text();
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
              }
            : a
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    }
    setSummarising(null);
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
              <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wide mb-3">
                Drafts — needs summarisation ({drafts.length})
              </h2>
              <div className="flex flex-col gap-3">
                {drafts.map((a) => (
                  <div key={a.id} className="bg-white rounded-xl px-5 py-4 shadow-sm border border-yellow-200">
                    <div className="flex items-start justify-between gap-4">
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
                        <TagPills
                          articleId={a.id}
                          articleTags={a.tags}
                          allTags={tags}
                          onToggle={toggleTag}
                        />
                      </div>
                      <div className="flex gap-2 shrink-0 items-start">
                        <button
                          onClick={() => summarise(a.id)}
                          disabled={summarising === a.id}
                          className="bg-yellow-400 hover:bg-yellow-500 text-amber-900 font-medium px-4 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {summarising === a.id ? "Summarising..." : "Summarise ✨"}
                        </button>
                        <button
                          onClick={() => remove(a.id)}
                          disabled={summarising === a.id}
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
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wide">
                  Ready to publish ({scheduled.length})
                </h2>
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
              <div className="flex flex-col gap-3">
                {scheduled.map((a) => (
                  <div key={a.id} className="bg-white rounded-xl px-5 py-4 shadow-sm border border-yellow-200">
                    <div className="flex items-start justify-between gap-4">
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
                            <p className="text-xs text-amber-400 mt-1">{a.source_name}</p>
                          </div>
                        </div>
                        <TagPills
                          articleId={a.id}
                          articleTags={a.tags}
                          allTags={tags}
                          onToggle={toggleTag}
                        />
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <input
                          type="date"
                          value={a.publish_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}
                          onChange={(e) => setDate(a.id, e.target.value)}
                          className="border border-yellow-200 rounded px-2 py-1 text-xs text-amber-800 focus:outline-none focus:border-yellow-400"
                        />
                        <div className="flex gap-2">
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
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
