"use client";

import { useState } from "react";

type Article = {
  id: number;
  title_en: string | null;
  title_nl: string | null;
  source_url: string;
  source_name: string;
  topic_name: string | null;
  topic_emoji: string | null;
  published_at: string | null;
  publish_date: string | null;
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

export default function HistoryClient({ initialArticles }: { initialArticles: Article[] }) {
  const [articles, setArticles] = useState<Article[]>(initialArticles);
  const [resetting, setResetting] = useState<Set<number>>(new Set());

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
      <h1 className="text-2xl font-bold text-amber-900 mb-1">History</h1>
      <p className="text-amber-700 text-sm mb-8">
        All published articles, most recent first. Click the title to open the original source.
      </p>

      {articles.length === 0 ? (
        <p className="text-amber-600 text-sm">Nothing published yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {articles.map((a) => {
            const postUrl = livePostUrl(a);
            return (
              <div
                key={a.id}
                className="bg-white rounded-xl px-5 py-4 shadow-sm border border-yellow-200 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl">{a.topic_emoji ?? "📰"}</span>
                  <div className="min-w-0">
                    <a
                      href={a.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-amber-900 text-sm hover:text-amber-600 transition-colors block truncate"
                      title="Open original source article"
                    >
                      {a.title_en ?? a.title_nl ?? a.source_url}
                    </a>
                    <p className="text-xs text-amber-500">{a.source_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
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
                  <span className="text-xs text-amber-400 whitespace-nowrap">
                    {a.published_at
                      ? new Date(a.published_at).toLocaleDateString("en-GB", {
                          day: "numeric", month: "short", year: "numeric",
                        })
                      : ""}
                  </span>
                  <button
                    onClick={() => resetToDraft(a.id)}
                    disabled={resetting.has(a.id)}
                    className="text-xs text-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50 whitespace-nowrap"
                    title="Reset to draft for re-summarisation"
                  >
                    {resetting.has(a.id) ? "Resetting…" : "Re-summarise"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
