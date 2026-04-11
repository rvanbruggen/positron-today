"use client";

import { useState, useMemo } from "react";
import EditArticleModal, { type EditableFields } from "@/app/components/EditArticleModal";

type ArticleTag = { id: number; name: string; emoji: string };

type Article = {
  id: number;
  title_en: string | null;
  title_nl: string | null;
  title_fr: string | null;
  summary_en: string | null;
  summary_nl: string | null;
  summary_fr: string | null;
  source_url: string;
  source_name: string;
  article_emoji: string | null;
  tags: ArticleTag[];
  published_at: string | null;
  publish_date: string | null;
  published_path: string | null;
  source_pub_date: string | null;
  image_url: string | null;
};

const SITE_BASE = "https://positron.today";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 60).replace(/-$/, "");
}

function livePostUrl(a: Article): string {
  // Prefer the stored published_path over reconstructing from slug
  if (a.published_path) {
    // published_path is e.g. "site/src/posts/2026-04-06-some-title.md"
    const filename = a.published_path.split("/").pop()?.replace(/\.md$/, "");
    if (filename) return `${SITE_BASE}/posts/${filename}/`;
  }
  const date = (a.publish_date ?? a.published_at ?? "").slice(0, 10);
  const title = a.title_en ?? a.title_nl ?? "";
  if (!date || !title) return "";
  return `${SITE_BASE}/posts/${date}-${slugify(title)}/`;
}

function articleMonth(a: Article): string {
  return (a.published_at ?? a.publish_date ?? "").slice(0, 7);
}

function formatMonth(ym: string): string {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type SortKey = "title" | "source" | "date";
type SortDir = "asc" | "desc";

export default function HistoryClient({
  initialArticles,
  allTags,
}: {
  initialArticles: Article[];
  allTags: ArticleTag[];
}) {
  const [articles, setArticles]           = useState<Article[]>(initialArticles);
  const [resetting, setResetting]         = useState<Set<number>>(new Set());
  const [republishing, setRepublishing]   = useState<Set<number>>(new Set());
  const [republished, setRepublished]     = useState<Set<number>>(new Set());
  const [removing, setRemoving]           = useState<Set<number>>(new Set());
  const [generatingCard, setGeneratingCard] = useState<Set<number>>(new Set());
  const [filterTag, setFilterTag]         = useState("all");
  const [filterMonth, setFilterMonth]     = useState("all");
  const [sortKey, setSortKey]             = useState<SortKey>("date");
  const [sortDir, setSortDir]             = useState<SortDir>("desc");
  const [error, setError]                 = useState<string | null>(null);
  const [editingId, setEditingId]         = useState<number | null>(null);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="ml-1 opacity-30">↕</span>;
    return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const availableTags = useMemo(
    () => [...new Set(articles.flatMap((a) => a.tags.map((t) => t.name)))].sort(),
    [articles]
  );

  const availableMonths = useMemo(
    () => [...new Set(articles.map(articleMonth).filter(Boolean))].sort().reverse(),
    [articles]
  );

  const displayed = useMemo(() => {
    const filtered = articles.filter((a) => {
      if (filterTag !== "all" && !a.tags.some((t) => t.name === filterTag)) return false;
      if (filterMonth !== "all" && articleMonth(a) !== filterMonth) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "title") {
        cmp = (a.title_en ?? a.title_nl ?? "").localeCompare(b.title_en ?? b.title_nl ?? "");
      } else if (sortKey === "source") {
        cmp = a.source_name.localeCompare(b.source_name);
      } else {
        // date — compare ISO strings directly
        cmp = (a.published_at ?? "").localeCompare(b.published_at ?? "");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [articles, filterTag, filterMonth, sortKey, sortDir]);

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
      if (!res.ok) { setError(data.error ?? `Republish failed: ${res.status}`); return; }
      setRepublished((prev) => new Set(prev).add(id));
      setTimeout(() => setRepublished((prev) => { const s = new Set(prev); s.delete(id); return s; }), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setRepublishing((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  async function resummarise(id: number) {
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

  async function removeFromSite(article: Article) {
    if (!confirm(`Remove "${article.title_en ?? article.title_nl ?? "this article"}" from the live site?`)) return;
    setRemoving((prev) => new Set(prev).add(article.id));
    setError(null);
    try {
      const params = new URLSearchParams({ id: String(article.id) });
      if (article.published_path) params.set("published_path", article.published_path);
      const res = await fetch(`/api/articles?${params}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Removal failed"); return; }
      setArticles((prev) => prev.filter((a) => a.id !== article.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setRemoving((prev) => { const s = new Set(prev); s.delete(article.id); return s; });
    }
  }

  async function generateInstagramCard(a: Article) {
    setGeneratingCard((prev) => new Set(prev).add(a.id));
    setError(null);
    try {
      const res = await fetch(`/api/instagram-card?id=${a.id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Card generation failed: ${res.status}`);
        return;
      }
      // Trigger browser download
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a_el = document.createElement("a");
      a_el.href  = url;
      const slug = (a.title_en ?? a.title_nl ?? "article").toLowerCase().replace(/[^\w]+/g, "-").slice(0, 50);
      a_el.download = `positron-${slug}.png`;
      a_el.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setGeneratingCard((prev) => { const s = new Set(prev); s.delete(a.id); return s; });
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-amber-900">History</h1>
        <span className="text-sm text-amber-500">{displayed.length} of {articles.length} articles</span>
      </div>
      <p className="text-amber-700 text-sm mb-6">
        All published articles. Re-summarise moves the article back to the Preview queue. Remove deletes it from the live site.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700 mb-4">{error}</div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl px-5 py-3 shadow-sm border border-yellow-200 mb-5 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Tag</label>
          <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)}
            className="border border-yellow-200 rounded-lg px-3 py-1.5 text-sm text-amber-900 focus:outline-none focus:border-yellow-400 bg-white">
            <option value="all">All tags</option>
            {availableTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Month</label>
          <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
            className="border border-yellow-200 rounded-lg px-3 py-1.5 text-sm text-amber-900 focus:outline-none focus:border-yellow-400 bg-white">
            <option value="all">All months</option>
            {availableMonths.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
          </select>
        </div>
        {(filterTag !== "all" || filterMonth !== "all") && (
          <button onClick={() => { setFilterTag("all"); setFilterMonth("all"); }}
            className="text-xs text-amber-500 hover:text-amber-700 transition-colors">
            Clear ✕
          </button>
        )}
      </div>

      {displayed.length === 0 ? (
        <p className="text-amber-600 text-sm">{articles.length === 0 ? "Nothing published yet." : "No articles match these filters."}</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-yellow-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-yellow-100 bg-amber-50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wide">
                  <button onClick={() => handleSort("title")} className="flex items-center hover:text-amber-900 transition-colors">
                    Title<SortIcon col="title" />
                  </button>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wide hidden md:table-cell">
                  <button onClick={() => handleSort("source")} className="flex items-center hover:text-amber-900 transition-colors">
                    Source<SortIcon col="source" />
                  </button>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wide hidden lg:table-cell">Tags</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wide whitespace-nowrap">
                  <button onClick={() => handleSort("date")} className="flex items-center hover:text-amber-900 transition-colors">
                    Date<SortIcon col="date" />
                  </button>
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((a, i) => {
                const postUrl = livePostUrl(a);
                const title = a.title_en ?? a.title_nl ?? a.source_url;
                const isLast = i === displayed.length - 1;
                return (
                  <tr key={a.id} className={`${!isLast ? "border-b border-yellow-50" : ""} hover:bg-amber-50/40 transition-colors`}>

                    {/* Title */}
                    <td className="px-4 py-2.5 max-w-xs">
                      <div className="flex items-start gap-1.5">
                        <span className="shrink-0 text-base leading-5">{a.article_emoji ?? "📰"}</span>
                        <div className="min-w-0">
                          {postUrl ? (
                            <a href={postUrl} target="_blank" rel="noopener noreferrer"
                              className="font-medium text-amber-900 hover:text-amber-600 transition-colors line-clamp-2 leading-snug">
                              {title}
                            </a>
                          ) : (
                            <span className="font-medium text-amber-900 line-clamp-2 leading-snug">{title}</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Source */}
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <a href={a.source_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-amber-500 hover:text-amber-700 transition-colors whitespace-nowrap">
                        {a.source_name}
                      </a>
                    </td>

                    {/* Tags */}
                    <td className="px-4 py-2.5 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {a.tags.length > 0
                          ? a.tags.map((t) => (
                              <span key={t.id} className="text-xs bg-yellow-100 text-amber-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                {t.emoji} {t.name}
                              </span>
                            ))
                          : <span className="text-xs text-amber-300">—</span>
                        }
                      </div>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-2.5 text-xs text-amber-500 whitespace-nowrap">
                      {a.source_pub_date ? (
                        <div>
                          <div title="Original source date">{formatDate(a.source_pub_date)}</div>
                          <div className="text-amber-300 text-[10px]" title="Date published to site">published {formatDate(a.published_at ?? a.publish_date)}</div>
                        </div>
                      ) : (
                        formatDate(a.published_at ?? a.publish_date)
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 justify-end whitespace-nowrap">
                        <button
                          onClick={() => generateInstagramCard(a)}
                          disabled={generatingCard.has(a.id)}
                          title="Generate Instagram card"
                          className="text-xs bg-pink-100 hover:bg-pink-200 text-pink-700 px-2 py-1 rounded transition-colors disabled:opacity-50 font-medium">
                          {generatingCard.has(a.id) ? "⏳" : "📸"}
                        </button>
                        <button onClick={() => setEditingId(a.id)}
                          className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-2 py-1 rounded transition-colors font-medium">
                          Edit
                        </button>
                        <button onClick={() => republish(a.id)}
                          disabled={republishing.has(a.id) || republished.has(a.id)}
                          className="text-xs bg-green-100 hover:bg-green-200 text-green-700 px-2 py-1 rounded transition-colors disabled:opacity-50 font-medium">
                          {republished.has(a.id) ? "✓" : republishing.has(a.id) ? "…" : "Republish"}
                        </button>
                        <button onClick={() => resummarise(a.id)}
                          disabled={resetting.has(a.id)}
                          className="text-xs text-blue-500 hover:text-blue-700 transition-colors disabled:opacity-50">
                          {resetting.has(a.id) ? "…" : "Re-summarise"}
                        </button>
                        <button onClick={() => removeFromSite(a)}
                          disabled={removing.has(a.id)}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50">
                          {removing.has(a.id) ? "…" : "Remove"}
                        </button>
                      </div>
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingId !== null && (() => {
        const a = articles.find((x) => x.id === editingId);
        if (!a) return null;
        return (
          <EditArticleModal
            articleId={a.id}
            isPublished={true}
            initial={{
              title_en: a.title_en ?? "",
              title_nl: a.title_nl ?? "",
              title_fr: a.title_fr ?? "",
              summary_en: a.summary_en ?? "",
              summary_nl: a.summary_nl ?? "",
              summary_fr: a.summary_fr ?? "",
              article_emoji: a.article_emoji ?? "✨",
            }}
            onClose={() => setEditingId(null)}
            onSaved={(fields: EditableFields) => {
              setArticles((prev) => prev.map((x) =>
                x.id === editingId ? { ...x, ...fields } : x
              ));
              setRepublished((prev) => new Set(prev).add(editingId));
              setTimeout(() => setRepublished((prev) => { const s = new Set(prev); s.delete(editingId!); return s; }), 2500);
            }}
          />
        );
      })()}
    </div>
  );
}
