"use client";

import { useState, useMemo } from "react";

type Article = {
  id: number;
  title_en: string | null;
  title_nl: string | null;
  source_url: string;
  source_name: string;
  topic_id: number | null;
  topic_name: string | null;
  topic_emoji: string | null;
  published_at: string | null;
  publish_date: string | null;
};

type Topic = {
  id: number;
  name: string;
  emoji: string;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/-$/, "");
}

function livePostUrl(article: Article): string {
  const date = (article.publish_date ?? article.published_at ?? "").slice(0, 10);
  const title = article.title_en ?? article.title_nl ?? "";
  if (!date || !title) return "";
  return `https://rvanbruggen.github.io/positiviteiten/posts/${date}-${slugify(title)}/`;
}

function articleMonth(a: Article): string {
  return (a.published_at ?? a.publish_date ?? "").slice(0, 7);
}

function formatMonth(ym: string): string {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", {
    month: "long", year: "numeric",
  });
}

export default function HistoryClient({
  initialArticles,
  topics,
}: {
  initialArticles: Article[];
  topics: Topic[];
}) {
  const [articles, setArticles] = useState<Article[]>(initialArticles);
  const [resetting, setResetting] = useState<Set<number>>(new Set());
  const [republishing, setRepublishing] = useState<Set<number>>(new Set());
  const [republished, setRepublished] = useState<Set<number>>(new Set());
  const [filterTopic, setFilterTopic] = useState("all");
  const [filterMonth, setFilterMonth] = useState("all");
  const [error, setError] = useState<string | null>(null);

  const availableTopics = useMemo(
    () => [...new Set(articles.map((a) => a.topic_name).filter(Boolean) as string[])].sort(),
    [articles]
  );

  const availableMonths = useMemo(
    () => [...new Set(articles.map(articleMonth).filter(Boolean))].sort().reverse(),
    [articles]
  );

  const displayed = articles.filter((a) => {
    if (filterTopic !== "all" && a.topic_name !== filterTopic) return false;
    if (filterMonth !== "all" && articleMonth(a) !== filterMonth) return false;
    return true;
  });

  async function changeTopic(id: number, topicId: number | null) {
    const topic = topics.find((t) => t.id === topicId) ?? null;
    await fetch("/api/articles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, topic_id: topicId }),
    });
    setArticles((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, topic_id: topicId, topic_name: topic?.name ?? null, topic_emoji: topic?.emoji ?? null }
          : a
      )
    );
  }

  async function republish(id: number) {
    setRepublishing((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Republish failed: ${res.status}`);
        return;
      }
      setRepublished((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setRepublished((prev) => { const s = new Set(prev); s.delete(id); return s; });
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    }
    setRepublishing((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function resetToDraft(id: number) {
    setResetting((prev) => new Set(prev).add(id));
    try {
      await fetch("/api/articles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, reset_to_draft: true }),
      });
      setArticles((prev) => prev.filter((a) => a.id !== id));
    } finally {
      setResetting((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-amber-900">History</h1>
        <span className="text-sm text-amber-500">{displayed.length} of {articles.length} articles</span>
      </div>
      <p className="text-amber-700 text-sm mb-6">
        All published articles. Click a title to open the original source. Change a topic and hit Republish to update the live post.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl px-5 py-4 shadow-sm border border-yellow-200 mb-6 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Topic</label>
          <select
            value={filterTopic}
            onChange={(e) => setFilterTopic(e.target.value)}
            className="border border-yellow-200 rounded-lg px-3 py-1.5 text-sm text-amber-900 focus:outline-none focus:border-yellow-400 bg-white"
          >
            <option value="all">All topics</option>
            {availableTopics.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Month</label>
          <select
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="border border-yellow-200 rounded-lg px-3 py-1.5 text-sm text-amber-900 focus:outline-none focus:border-yellow-400 bg-white"
          >
            <option value="all">All months</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>{formatMonth(m)}</option>
            ))}
          </select>
        </div>
        {(filterTopic !== "all" || filterMonth !== "all") && (
          <button
            onClick={() => { setFilterTopic("all"); setFilterMonth("all"); }}
            className="text-xs text-amber-500 hover:text-amber-700 transition-colors"
          >
            Clear filters ✕
          </button>
        )}
      </div>

      {displayed.length === 0 ? (
        <p className="text-amber-600 text-sm">
          {articles.length === 0 ? "Nothing published yet." : "No articles match these filters."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {displayed.map((a) => {
            const postUrl = livePostUrl(a);
            return (
              <div
                key={a.id}
                className="bg-white rounded-xl px-5 py-4 shadow-sm border border-yellow-200"
              >
                {/* Top row: emoji + title + source */}
                <div className="flex items-start gap-3 mb-3">
                  <span className="text-xl shrink-0 mt-0.5">{a.topic_emoji ?? "📰"}</span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={a.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-amber-900 text-sm hover:text-amber-600 transition-colors block"
                      title="Open original source article"
                    >
                      {a.title_en ?? a.title_nl ?? a.source_url}
                    </a>
                    <p className="text-xs text-amber-500 mt-0.5">{a.source_name}</p>
                  </div>
                  <span className="text-xs text-amber-400 whitespace-nowrap shrink-0">
                    {a.published_at
                      ? new Date(a.published_at).toLocaleDateString("en-GB", {
                          day: "numeric", month: "short", year: "numeric",
                        })
                      : ""}
                  </span>
                </div>

                {/* Bottom row: topic selector + actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  {topics.length > 0 && (
                    <select
                      value={a.topic_id ?? ""}
                      onChange={(e) => changeTopic(a.id, e.target.value ? Number(e.target.value) : null)}
                      className="border border-yellow-200 rounded-lg px-2 py-1 text-xs text-amber-800 focus:outline-none focus:border-yellow-400 bg-amber-50"
                    >
                      <option value="">No topic</option>
                      {topics.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.emoji} {t.name}
                        </option>
                      ))}
                    </select>
                  )}

                  <div className="ml-auto flex items-center gap-2">
                    {postUrl && (
                      <a
                        href={postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-amber-600 hover:text-amber-800 transition-colors font-medium"
                      >
                        Live post ↗
                      </a>
                    )}
                    <button
                      onClick={() => republish(a.id)}
                      disabled={republishing.has(a.id) || republished.has(a.id)}
                      className="text-xs bg-green-100 hover:bg-green-200 text-green-700 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50 font-medium"
                    >
                      {republished.has(a.id) ? "Updated ✓" : republishing.has(a.id) ? "Updating…" : "Republish ↑"}
                    </button>
                    <button
                      onClick={() => resetToDraft(a.id)}
                      disabled={resetting.has(a.id)}
                      className="text-xs text-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50"
                      title="Reset to draft for full re-summarisation"
                    >
                      {resetting.has(a.id) ? "Resetting…" : "Re-summarise"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
